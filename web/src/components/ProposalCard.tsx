import { useState } from "react";
import type { CampoContratoVisible, CorreccionesVisibles, DecisionVisible, ItemBandeja, ValorCampoVisible } from "../lib/api";
import { CAMPOS, ETIQUETA_CAMPO, ETIQUETA_CLASIFICACION, UMBRAL_CONFIANZA, fechaHora, mensajeDeFalla, mostrarValor, porcentaje } from "../lib/format";

type Valores = Record<CampoContratoVisible, string>;

const aTexto = (valor: ValorCampoVisible): string => (valor === null ? "" : String(valor));

/** Convierte lo escrito al tipo del campo; un número mal escrito se avisa aquí antes de llamar a la API. */
function aValor(campo: CampoContratoVisible, texto: string): string | number | boolean {
  if (campo === "valor") {
    const numero = Number(texto.replace(/[\s.,$]/g, ""));
    if (!Number.isFinite(numero)) throw new Error("El valor debe ser un número sin separadores (0 si es por demanda).");
    return numero;
  }
  return campo === "requiere_poliza" ? texto === "true" : texto;
}

function correccionesDe(valores: Valores, originales: Valores): CorreccionesVisibles {
  const correcciones: CorreccionesVisibles = {};
  for (const { campo } of CAMPOS) {
    const texto = valores[campo].trim();
    if (texto && texto !== originales[campo]) correcciones[campo] = aValor(campo, texto);
  }
  return correcciones;
}

type Props = {
  item: ItemBandeja;
  disabled: boolean;
  onAprobar: (mensajeId: string, correcciones: CorreccionesVisibles) => Promise<void>;
  onRechazar: (mensajeId: string, motivo: string) => Promise<void>;
};

function CampoEditable({ item, campo, valor, bloqueado, onCambio }: { item: ItemBandeja; campo: CampoContratoVisible; valor: string; bloqueado: boolean; onCambio: (texto: string) => void }) {
  const { confianza } = item.contrato[campo];
  const enRevision = item.validacion.requiere_revision.includes(campo) || confianza < UMBRAL_CONFIANZA;
  const editado = valor.trim() !== aTexto(item.contrato[campo].valor);
  return (
    <label className={`field ${enRevision ? "low" : ""} ${editado ? "edited" : ""} ${campo === "objeto" ? "wide" : ""}`}>
      <span className="field-label">
        {ETIQUETA_CAMPO[campo]}
        <span className="conf">{porcentaje(confianza)}</span>
      </span>
      {campo === "requiere_poliza" ? (
        <select value={valor} disabled={bloqueado} onChange={(evento) => onCambio(evento.target.value)}>
          <option value="">—</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      ) : (
        <input value={valor} disabled={bloqueado} placeholder={campo.startsWith("fecha") ? "YYYY-MM-DD" : ""} onChange={(evento) => onCambio(evento.target.value)} />
      )}
      <span className="bar">
        <span style={{ width: porcentaje(confianza) }} />
      </span>
    </label>
  );
}

/** Tarjeta de decisión humana: corregir campos y aprobar (registrar con confirmación) o rechazar con motivo. */
export function ProposalCard({ item, disabled, onAprobar, onRechazar }: Props) {
  const { mensaje, validacion, contrato } = item;
  const originales = Object.fromEntries(CAMPOS.map(({ campo }) => [campo, aTexto(contrato[campo].valor)])) as Valores;
  const [valores, setValores] = useState<Valores>(originales);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const bloqueado = disabled || enviando;

  async function ejecutar(accion: () => Promise<void>): Promise<void> {
    setEnviando(true);
    setError(null);
    try {
      await accion();
    } catch (falla) {
      setError(mensajeDeFalla(falla));
    } finally {
      setEnviando(false);
    }
  }

  const aprobar = () => ejecutar(() => onAprobar(mensaje.id, correccionesDe(valores, originales)));
  const rechazar = () =>
    ejecutar(async () => {
      if (!motivo.trim()) throw new Error("Escribe el motivo del rechazo.");
      await onRechazar(mensaje.id, motivo.trim());
    });
  const corregidos = CAMPOS.filter(({ campo }) => valores[campo].trim() && valores[campo].trim() !== originales[campo]).length;

  return (
    <article className="card rec-revision">
      <header className="card-head">
        <div>
          <strong>{mensaje.id}</strong>
          <span className="muted"> · {ETIQUETA_CLASIFICACION[validacion.clasificacion]}</span>
          {validacion.id_contrato_existente ? <span className="muted"> de {validacion.id_contrato_existente}</span> : null}
        </div>
        <span className="pill pill-revision">Revisar datos</span>
      </header>
      <p className="card-sub">
        {mensaje.de} · “{mensaje.asunto}”
      </p>
      <div className="card-reco">
        <span className="muted">El agente no registra sin tu confirmación. Campos en revisión:</span>
        <ul>
          {validacion.revisiones.map((revision) => (
            <li key={`${revision.campo}-${revision.motivo}`}>
              <b>{ETIQUETA_CAMPO[revision.campo]}</b>: {revision.motivo}
            </li>
          ))}
          {validacion.diferencias.map((diferencia) => (
            <li key={`dif-${diferencia.campo}`}>
              {ETIQUETA_CAMPO[diferencia.campo]}: maestro {mostrarValor(diferencia.maestro, diferencia.campo)} → documento {mostrarValor(diferencia.documento, diferencia.campo)}
            </li>
          ))}
          {validacion.avisos.map((aviso) => (
            <li key={aviso} className="aviso">
              {aviso}
            </li>
          ))}
        </ul>
      </div>
      <div className="fields">
        {CAMPOS.map(({ campo }) => (
          <CampoEditable key={campo} item={item} campo={campo} valor={valores[campo]} bloqueado={bloqueado} onCambio={(texto) => setValores((previos) => ({ ...previos, [campo]: texto }))} />
        ))}
      </div>
      <textarea className="comment" placeholder="Motivo (obligatorio para rechazar)" value={motivo} disabled={bloqueado} onChange={(evento) => setMotivo(evento.target.value)} rows={2} />
      {error ? (
        <div className="card-error" role="alert">
          {error}
        </div>
      ) : null}
      <footer className="card-actions">
        <button type="button" className="ghost danger" disabled={bloqueado} onClick={() => void rechazar()}>
          Rechazar
        </button>
        <button type="button" disabled={bloqueado} onClick={() => void aprobar()}>
          {enviando ? "Aplicando…" : "Confirmar datos y registrar"}
          {corregidos ? ` (${corregidos} corrección/es)` : ""}
        </button>
      </footer>
    </article>
  );
}

/** Tarjeta posterior a la decisión: quién decidió, por qué canal, qué corrigió y qué se escribió. */
export function ResolutionCard({ decision }: { decision: DecisionVisible }) {
  const rechazada = decision.decision === "rechazado";
  const correcciones = Object.entries(decision.correcciones);
  // En una inserción todas las columnas "cambian": solo vale la pena detallar una actualización.
  const cambios = decision.accion === "actualizado" ? Object.entries(decision.cambios) : [];
  return (
    <article className={`card resolved ${rechazada ? "is-rejected" : "is-approved"}`}>
      <header className="card-head">
        <div>
          <strong>{decision.mensaje_id}</strong>
          <span className="muted"> · vía {decision.via}</span>
        </div>
        <span className={`pill ${rechazada ? "pill-rechazo" : "pill-ok"}`}>{rechazada ? "Rechazado" : "Aprobado"}</span>
      </header>
      <p className="card-sub">
        <b>{decision.aprobador}</b> {rechazada ? "rechazó" : "confirmó"}
        {decision.accion ? (
          <>
            {" "}
            → se ejecutó <b>{decision.accion}</b>
            {decision.id_contrato ? ` [${decision.id_contrato}]` : ""}
          </>
        ) : null}
      </p>
      {correcciones.length ? (
        <p className="muted small">Correcciones: {correcciones.map(([campo, valor]) => `${campo} = ${mostrarValor(valor)}`).join(", ")}</p>
      ) : null}
      {cambios.length ? (
        <p className="muted small">Cambios en maestro: {cambios.map(([columna, cambio]) => `${columna}: ${mostrarValor(cambio.antes)} → ${mostrarValor(cambio.despues)}`).join(" · ")}</p>
      ) : null}
      {decision.motivo ? <p className="small">“{decision.motivo}”</p> : null}
      <p className="muted small">{fechaHora(decision.ts)}</p>
    </article>
  );
}
