import { useEffect, useState } from "react";
import {
  api,
  type Campo,
  type CampoEditable,
  type CorreoDetalle,
  type CorreoResumen,
  type EstadoCorreo,
} from "../api";
import { ETIQUETA, PropuestaCard, ResolucionCard } from "../PropuestaCard";

const UMBRAL = 0.8;

const ESTADO_LABEL: Record<EstadoCorreo | "ANALIZANDO", string> = {
  SIN_ANALIZAR: "Sin analizar",
  PENDIENTE: "Por aprobar",
  APROBADA: "Aprobado",
  RECHAZADA: "Rechazado",
  ANALIZANDO: "Analizando…",
};

const CAMPOS: { key: CampoEditable; label: string }[] = [
  { key: "idContrato", label: "ID contrato" },
  { key: "cliente", label: "Cliente" },
  { key: "nit", label: "NIT" },
  { key: "valor", label: "Valor" },
  { key: "fechaInicio", label: "Inicio" },
  { key: "fechaFin", label: "Fin" },
];

function mostrar(k: CampoEditable, c: Campo | undefined): string {
  if (!c || c.valor === null || c.valor === undefined) return "—";
  if (k === "valor" && typeof c.valor === "number") return `$${c.valor.toLocaleString("es-CO")}`;
  return String(c.valor);
}

export function EstadoChip({ estado }: { estado: EstadoCorreo | "ANALIZANDO" }) {
  return <span className={`chip chip-${estado}`}>{ESTADO_LABEL[estado]}</span>;
}

type Props = {
  correos: CorreoResumen[];
  seleccionado: string | null;
  onSeleccionar: (id: string) => void;
  analizando: string | null;
  progreso: { hechos: number; total: number } | null;
  version: number;
  busy: boolean;
  onAnalizar: (id: string) => Promise<void>;
  onAnalizarTodo: () => Promise<void>;
  onDetener: () => void;
  onAprobar: Parameters<typeof PropuestaCard>[0]["onAprobar"];
  onRechazar: Parameters<typeof PropuestaCard>[0]["onRechazar"];
};

export function BuzonView(props: Props) {
  const { correos, seleccionado, analizando, progreso } = props;
  const sinAnalizar = correos.filter((c) => c.estado === "SIN_ANALIZAR").length;

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
            <button
              type="button"
              onClick={props.onAnalizarTodo}
              disabled={props.busy || sinAnalizar === 0}
              title="Analiza los correos pendientes uno a uno, en orden"
            >
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
          {correos.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`mail ${seleccionado === c.id ? "active" : ""}`}
                onClick={() => props.onSeleccionar(c.id)}
              >
                <span className="mail-top">
                  <b>{c.id}</b>
                  <EstadoChip estado={analizando === c.id ? "ANALIZANDO" : c.estado} />
                </span>
                <span className="mail-subject">{c.asunto}</span>
                <span className="mail-meta">
                  {c.de} · {c.fecha}
                </span>
                <span className="mail-meta">
                  {c.adjuntos.length ? `Adjuntos: ${c.adjuntos.join(", ")}` : "Sin adjuntos"}
                </span>
                {c.recomendacion ? (
                  <span className="mail-meta">
                    Agente: {ETIQUETA[c.recomendacion]}
                    {c.decisionFinal ? ` → ${c.decisionFinal}` : ""}
                    {c.contratoId ? ` [${c.contratoId}]` : ""}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {seleccionado ? (
        <CorreoDetalleView key={seleccionado} id={seleccionado} {...props} />
      ) : (
        <section className="panel detail empty-detail">
          <p className="empty">Selecciona un correo para ver su contenido y cómo se va resolviendo.</p>
        </section>
      )}
    </div>
  );
}

function CorreoDetalleView({
  id,
  version,
  analizando,
  busy,
  onAnalizar,
  onAprobar,
  onRechazar,
}: Props & { id: string }) {
  const [detalle, setDetalle] = useState<CorreoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    api
      .correo(id)
      .then((d) => {
        if (!vivo) return;
        setDetalle(d);
        setError(null);
      })
      .catch((e) => vivo && setError(String((e as Error).message ?? e)))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [id, version]);

  if (error) {
    return (
      <section className="panel detail">
        <p className="error">No se pudo cargar {id}: {error}</p>
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

  const { correo, propuesta: p, estado, timeline, extraccionOriginal, eventos } = detalle;
  const agente = extraccionOriginal ?? p?.extraccion ?? null;
  const final = p?.resolucion ? p.extraccion : null;
  const esteAnalizando = analizando === id;

  return (
    <section className={`panel detail ${cargando ? "is-loading" : ""}`}>
      <div className="panel-head">
        <div>
          <h2>
            {correo.id} · {correo.asunto}
          </h2>
          <p className="muted small">
            {correo.de} · {correo.fecha}
          </p>
        </div>
        <div className="head-actions">
          <EstadoChip estado={esteAnalizando ? "ANALIZANDO" : estado} />
          {estado === "SIN_ANALIZAR" ? (
            <button type="button" onClick={() => onAnalizar(id)} disabled={busy || !!analizando}>
              Analizar
            </button>
          ) : null}
        </div>
      </div>

      <ol className="timeline">
        {timeline.map((t, i) => (
          <li
            key={t.id}
            className={`step step-${esteAnalizando && i === 0 ? "actual" : t.estado}`}
            title={t.ts ? new Date(t.ts).toLocaleString("es-CO") : undefined}
          >
            <span className="dot">{i + 1}</span>
            <span className="step-title">{t.titulo}</span>
            {t.detalle ? <span className="step-detail">{t.detalle}</span> : null}
          </li>
        ))}
      </ol>

      <div className="side-by-side">
        <div className="col">
          <h3>Correo original</h3>
          <div className="doc">
            <div className="doc-label">Cuerpo</div>
            <pre>{correo.cuerpo}</pre>
          </div>
          {correo.adjuntos.map((a) => (
            <div key={a.nombre} className={`doc ${p?.documento === a.nombre ? "used" : ""}`}>
              <div className="doc-label">
                Adjunto: {a.nombre}
                {p?.documento === a.nombre ? <span className="muted"> · usado para extraer</span> : null}
              </div>
              <pre>{a.texto}</pre>
            </div>
          ))}
        </div>

        <div className="col">
          <h3>Lo que entendió el agente</h3>
          {p ? (
            <>
              <p className="small">
                Tipo <b>{p.clasificacion.tipo}</b> ({Math.round(p.clasificacion.confianza * 100)}%) ·
                motor {p.motor}
                <br />
                <span className="muted">{p.clasificacion.razon}</span>
              </p>

              {agente ? (
                <table className="extract">
                  <thead>
                    <tr>
                      <th>Campo</th>
                      <th>Agente</th>
                      <th>Confianza</th>
                      {final ? <th>Final</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {CAMPOS.map(({ key, label }) => {
                      const c = agente[key];
                      const conValor = c && c.valor !== null;
                      const baja = conValor && c.confianza < UMBRAL;
                      const fin = final ? mostrar(key, final[key]) : null;
                      const cambio = fin !== null && fin !== mostrar(key, c);
                      return (
                        <tr key={key} className={baja ? "low" : ""}>
                          <td>{label}</td>
                          <td>
                            {mostrar(key, c)}
                            {c?.evidencia && baja ? (
                              <div className="muted small">“{c.evidencia}”</div>
                            ) : null}
                          </td>
                          <td>
                            {conValor ? (
                              <span className="conf-cell">
                                <span className="bar">
                                  <span style={{ width: `${Math.round(c.confianza * 100)}%` }} />
                                </span>
                                {Math.round(c.confianza * 100)}%
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          {final ? <td className={cambio ? "changed" : ""}>{fin}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">Sin extracción (no aplica para este tipo de correo).</p>
              )}

              <div className="card-reco">
                <span className="muted">Recomendación:</span> <b>{ETIQUETA[p.recomendacion]}</b>
                <ul>
                  {p.motivos.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>

              <details className="rules">
                <summary>
                  Reglas ({p.validaciones.filter((v) => v.ok).length}/{p.validaciones.length} OK)
                </summary>
                <ul>
                  {p.validaciones.map((v) => (
                    <li key={v.regla} className={v.ok ? "ok" : "fail"}>
                      {v.ok ? "✓" : "✗"} <b>{v.regla}</b> · {v.detalle}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="empty">
              {esteAnalizando
                ? "El agente está analizando este correo…"
                : "Todavía no se ha analizado. Usa “Analizar” o “Analizar todo en orden”."}
            </p>
          )}
        </div>
      </div>

      {p && p.estado === "PENDIENTE" ? (
        <div className="detail-action">
          <h3>Tu decisión</h3>
          <PropuestaCard
            key={`${p.msgId}-${p.creadaEn}`}
            propuesta={p}
            disabled={busy}
            onAprobar={onAprobar}
            onRechazar={onRechazar}
          />
        </div>
      ) : null}
      {p?.resolucion ? (
        <div className="detail-action">
          <h3>Resultado</h3>
          <ResolucionCard propuesta={p} />
        </div>
      ) : null}

      {eventos.length ? (
        <details className="rules">
          <summary>Registro de auditoría ({eventos.length} evento/s)</summary>
          {eventos.map((e) => (
            <div key={`${e.ts}-${e.fase}`} className="event">
              <div className="small">
                <b>{e.fase ?? "evento"}</b> · {e.decision ?? "—"}
                {e.aprobador ? ` · ${e.aprobador}` : ""} ·{" "}
                <span className="muted">{new Date(e.ts).toLocaleString("es-CO")}</span>
              </div>
              <ul className="small">
                {e.log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}
