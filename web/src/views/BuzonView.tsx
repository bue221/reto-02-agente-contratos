import { useEffect, useState } from "react";
import { type CorreccionesVisibles, type DetalleMensaje, type MensajeBuzon, api } from "../api";
import { CAMPOS, ETIQUETA_CAMPO, ETIQUETA_CLASIFICACION, ETIQUETA_ESTADO, type EstadoVisible, UMBRAL_CONFIANZA, fechaHora, mensajeDeFalla, mostrarValor, porcentaje } from "../formato";
import { PropuestaCard, ResolucionCard } from "../PropuestaCard";

export function EstadoChip({ estado }: { estado: EstadoVisible }) {
  return <span className={`chip chip-${estado}`}>{ETIQUETA_ESTADO[estado]}</span>;
}

type Acciones = {
  busy: boolean;
  analizando: string | null;
  onAnalizar: (id: string) => Promise<void>;
  onAprobar: (id: string, correcciones: CorreccionesVisibles) => Promise<void>;
  onRechazar: (id: string, motivo: string) => Promise<void>;
};

type Props = Acciones & {
  mensajes: MensajeBuzon[];
  seleccionado: string | null;
  onSeleccionar: (id: string) => void;
  progreso: { hechos: number; total: number } | null;
  /** Cambia tras cada refresco para recargar el detalle abierto. */
  version: number;
  onAnalizarTodo: () => Promise<void>;
  onDetener: () => void;
};

function ItemCorreo({ mensaje, activo, analizando, onSeleccionar }: { mensaje: MensajeBuzon; activo: boolean; analizando: boolean; onSeleccionar: () => void }) {
  return (
    <li>
      <button type="button" className={`mail ${activo ? "active" : ""}`} onClick={onSeleccionar}>
        <span className="mail-top">
          <b>{mensaje.id}</b>
          <EstadoChip estado={analizando ? "analizando" : mensaje.estado} />
        </span>
        <span className="mail-subject">{mensaje.asunto}</span>
        <span className="mail-meta">
          {mensaje.de} · {fechaHora(mensaje.fecha)}
        </span>
        <span className="mail-meta">{mensaje.adjuntos.length ? `Adjuntos: ${mensaje.adjuntos.join(", ")}` : "Sin adjuntos"}</span>
        {mensaje.clasificacion ? (
          <span className="mail-meta">
            Agente: {ETIQUETA_CLASIFICACION[mensaje.clasificacion]}
            {mensaje.id_contrato ? ` [${mensaje.id_contrato}]` : ""}
            {mensaje.decidido_por ? ` · decidió ${mensaje.decidido_por}` : ""}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function BuzonView(props: Props) {
  const { mensajes, seleccionado, analizando, progreso } = props;
  const sinAnalizar = mensajes.filter((mensaje) => mensaje.estado === "pendiente").length;
  return (
    <div className="buzon-layout">
      <section className="panel mail-list">
        <div className="panel-head">
          <h2>Correos</h2>
          {progreso ? (
            <button type="button" className="ghost danger" onClick={props.onDetener}>
              Detener
            </button>
          ) : (
            <button type="button" onClick={() => void props.onAnalizarTodo()} disabled={props.busy || sinAnalizar === 0} title="Analiza los correos sin analizar uno a uno, en orden">
              Analizar todo en orden
            </button>
          )}
        </div>
        {progreso ? (
          <div className="progress">
            <div className="progress-text">
              Analizando {analizando ?? "…"} · {progreso.hechos}/{progreso.total}
            </div>
            <div className="bar big">
              <span style={{ width: `${(progreso.hechos / progreso.total) * 100}%` }} />
            </div>
          </div>
        ) : null}
        <ul className="mails">
          {mensajes.map((mensaje) => (
            <ItemCorreo key={mensaje.id} mensaje={mensaje} activo={seleccionado === mensaje.id} analizando={analizando === mensaje.id} onSeleccionar={() => props.onSeleccionar(mensaje.id)} />
          ))}
        </ul>
      </section>
      {seleccionado ? (
        <DetalleCorreo
          key={seleccionado}
          id={seleccionado}
          version={props.version}
          busy={props.busy}
          analizando={analizando}
          onAnalizar={props.onAnalizar}
          onAprobar={props.onAprobar}
          onRechazar={props.onRechazar}
        />
      ) : (
        <section className="panel detail empty-detail">
          <p className="empty">Selecciona un correo para ver su contenido y cómo se va resolviendo.</p>
        </section>
      )}
    </div>
  );
}

function LineaDeTiempo({ detalle, analizando }: { detalle: DetalleMensaje; analizando: boolean }) {
  return (
    <ol className="timeline">
      {detalle.linea_tiempo.map((paso, i) => (
        <li key={paso.id} className={`step step-${analizando && paso.estado === "pendiente" ? "actual" : paso.estado}`} title={paso.ts ? fechaHora(paso.ts) : undefined}>
          <span className="dot">{i + 1}</span>
          <span className="step-title">{paso.titulo}</span>
          {paso.detalle ? <span className="step-detail">{paso.detalle}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function CorreoOriginal({ detalle }: { detalle: DetalleMensaje }) {
  return (
    <div className="col">
      <h3>Correo original</h3>
      <div className="doc">
        <div className="doc-label">
          Para {detalle.para} · Cuerpo
        </div>
        <pre>{detalle.cuerpo || "(sin cuerpo)"}</pre>
      </div>
      {detalle.adjuntos.map((adjunto) => (
        <div key={adjunto.nombre} className={`doc ${adjunto.es_contrato ? "used" : ""}`}>
          <div className="doc-label">
            Adjunto: {adjunto.nombre}
            {adjunto.es_contrato ? <span className="muted"> · usado para extraer</span> : null}
          </div>
          <pre>{adjunto.texto ?? "(no se pudo leer el adjunto)"}</pre>
        </div>
      ))}
    </div>
  );
}

function TablaExtraccion({ detalle }: { detalle: DetalleMensaje }) {
  const { extraccion, validacion, fila } = detalle;
  if (!extraccion) return <p className="muted small">{detalle.error_extraccion ?? "Sin extracción para este correo."}</p>;
  return (
    <table className="extract">
      <thead>
        <tr>
          <th>Campo</th>
          <th>Agente</th>
          <th>Confianza</th>
          {fila ? <th>Maestro</th> : null}
        </tr>
      </thead>
      <tbody>
        {CAMPOS.map(({ campo, etiqueta }) => {
          const extraido = extraccion[campo];
          const dudoso = extraido.confianza < UMBRAL_CONFIANZA || validacion?.requiere_revision.includes(campo) === true;
          const final = fila ? mostrarValor(fila[campo], campo) : null;
          return (
            <tr key={campo} className={dudoso ? "low" : ""}>
              <td>{etiqueta}</td>
              <td>
                {mostrarValor(extraido.valor, campo)}
                {extraido.evidencia && dudoso ? <div className="muted small">“{extraido.evidencia}”</div> : null}
              </td>
              <td>
                <span className="conf-cell">
                  <span className="bar">
                    <span style={{ width: porcentaje(extraido.confianza) }} />
                  </span>
                  {porcentaje(extraido.confianza)}
                </span>
              </td>
              {final !== null ? <td className={final !== mostrarValor(extraido.valor, campo) ? "changed" : ""}>{final}</td> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Validacion({ detalle }: { detalle: DetalleMensaje }) {
  const { validacion } = detalle;
  if (!validacion) return null;
  return (
    <div className="card-reco">
      <span className="muted">Clasificación:</span> <b>{ETIQUETA_CLASIFICACION[validacion.clasificacion]}</b>
      {validacion.id_contrato_existente ? <span className="muted"> ({validacion.id_contrato_existente})</span> : null}
      <ul>
        {validacion.motivo ? <li>{validacion.motivo}</li> : null}
        {validacion.revisiones.map((revision) => (
          <li key={`${revision.campo}-${revision.motivo}`}>
            Revisar <b>{ETIQUETA_CAMPO[revision.campo]}</b>: {revision.motivo}
          </li>
        ))}
        {validacion.diferencias.map((diferencia) => (
          <li key={`dif-${diferencia.campo}`}>
            {ETIQUETA_CAMPO[diferencia.campo]}: {mostrarValor(diferencia.maestro, diferencia.campo)} → {mostrarValor(diferencia.documento, diferencia.campo)}
          </li>
        ))}
        {validacion.avisos.map((aviso) => (
          <li key={aviso} className="aviso">
            {aviso}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Auditoria({ detalle }: { detalle: DetalleMensaje }) {
  if (detalle.log.length === 0) return null;
  return (
    <details className="rules">
      <summary>Registro de auditoría ({detalle.log.length} llamada/s en out/log.jsonl)</summary>
      <ul>
        {detalle.log.map((entrada, i) => (
          <li key={`${entrada.ts}-${i}`} className={entrada.ok ? "ok" : "fail"}>
            {entrada.ok ? "✓" : "✗"} <b>{entrada.herramienta}</b> · {entrada.resumen} <span className="muted">· {fechaHora(entrada.ts)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function useDetalle(id: string, version: number): { detalle: DetalleMensaje | null; error: string | null; cargando: boolean } {
  const [detalle, setDetalle] = useState<DetalleMensaje | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    api
      .detalle(id)
      .then((respuesta) => {
        if (!vigente) return;
        setDetalle(respuesta);
        setError(null);
      })
      .catch((falla: unknown) => vigente && setError(mensajeDeFalla(falla)))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [id, version]);
  return { detalle, error, cargando };
}

function DetalleCorreo({ id, version, busy, analizando, onAnalizar, onAprobar, onRechazar }: Acciones & { id: string; version: number }) {
  const { detalle, error, cargando } = useDetalle(id, version);
  if (error) {
    return (
      <section className="panel detail">
        <p className="error">
          No se pudo cargar {id}: {error}
        </p>
      </section>
    );
  }
  if (!detalle) {
    return (
      <section className="panel detail">
        <p className="meta">Cargando {id}…</p>
      </section>
    );
  }
  const { mensaje } = detalle;
  const esteAnalizando = analizando === id;
  return (
    <section className={`panel detail ${cargando ? "is-loading" : ""}`}>
      <div className="panel-head">
        <div>
          <h2>
            {mensaje.id} · {mensaje.asunto}
          </h2>
          <p className="muted small">
            {mensaje.de} · {fechaHora(mensaje.fecha)}
          </p>
        </div>
        <div className="head-actions">
          <EstadoChip estado={esteAnalizando ? "analizando" : mensaje.estado} />
          {mensaje.estado === "pendiente" ? (
            <button type="button" onClick={() => void onAnalizar(id)} disabled={busy || analizando !== null}>
              Analizar
            </button>
          ) : null}
        </div>
      </div>
      <LineaDeTiempo detalle={detalle} analizando={esteAnalizando} />
      <div className="side-by-side">
        <CorreoOriginal detalle={detalle} />
        <div className="col">
          <h3>Lo que entendió el agente</h3>
          {mensaje.estado === "pendiente" ? (
            <p className="empty">{esteAnalizando ? "El agente está analizando este correo…" : "Todavía no se ha analizado. Usa «Analizar» o «Analizar todo en orden»."}</p>
          ) : (
            <>
              <TablaExtraccion detalle={detalle} />
              <Validacion detalle={detalle} />
            </>
          )}
        </div>
      </div>
      {mensaje.estado === "requiere_revision" && detalle.extraccion && detalle.validacion ? (
        <div className="detail-action">
          <h3>Tu decisión</h3>
          <PropuestaCard
            item={{ mensaje, validacion: detalle.validacion, contrato: detalle.extraccion, desde: "" }}
            disabled={busy}
            onAprobar={onAprobar}
            onRechazar={onRechazar}
          />
        </div>
      ) : null}
      {detalle.decision ? (
        <div className="detail-action">
          <h3>Resultado</h3>
          <ResolucionCard decision={detalle.decision} />
        </div>
      ) : null}
      <Auditoria detalle={detalle} />
    </section>
  );
}
