import { useState } from "react";
import { ApiError, type CampoEditable, type Decision, type Propuesta } from "./api";

const UMBRAL = 0.8;

const CAMPOS: { key: CampoEditable; label: string; placeholder: string }[] = [
  { key: "idContrato", label: "ID contrato", placeholder: "C-001" },
  { key: "cliente", label: "Cliente", placeholder: "Razón social" },
  { key: "nit", label: "NIT", placeholder: "900.111.222-3" },
  { key: "valor", label: "Valor (COP)", placeholder: "60000000" },
  { key: "fechaInicio", label: "Inicio", placeholder: "YYYY-MM-DD" },
  { key: "fechaFin", label: "Fin", placeholder: "YYYY-MM-DD" },
];

export const ETIQUETA: Record<Decision, string> = {
  REGISTRAR_NUEVO: "Registrar nuevo",
  ACTUALIZAR: "Actualizar existente",
  DUPLICADO: "Duplicado",
  RECHAZAR: "Rechazar",
  REVISION_HUMANA: "Revisar datos",
};

const TEXTO_APROBAR: Record<Decision, string> = {
  REGISTRAR_NUEVO: "Aprobar y registrar",
  ACTUALIZAR: "Aprobar y actualizar",
  DUPLICADO: "Aprobar: archivar duplicado",
  RECHAZAR: "Aprobar rechazo",
  REVISION_HUMANA: "Confirmar datos y aprobar",
};

type Props = {
  propuesta: Propuesta;
  disabled: boolean;
  onAprobar: (
    id: string,
    correcciones: Partial<Record<CampoEditable, string>>,
    comentario: string,
  ) => Promise<void>;
  onRechazar: (id: string, comentario: string) => Promise<void>;
};

export function PropuestaCard({ propuesta: p, disabled, onAprobar, onRechazar }: Props) {
  const original = (k: CampoEditable) => {
    const v = p.extraccion?.[k]?.valor;
    return v === null || v === undefined ? "" : String(v);
  };
  const [valores, setValores] = useState<Record<CampoEditable, string>>(() =>
    Object.fromEntries(CAMPOS.map(({ key }) => [key, original(key)])) as Record<CampoEditable, string>,
  );
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState<{ msg: string; motivos: string[] } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const correcciones = Object.fromEntries(
    CAMPOS.filter(({ key }) => valores[key].trim() && valores[key].trim() !== original(key)).map(
      ({ key }) => [key, valores[key].trim()],
    ),
  ) as Partial<Record<CampoEditable, string>>;

  async function ejecutar(fn: () => Promise<void>) {
    setEnviando(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const err = e as ApiError;
      setError({ msg: err.message, motivos: err.motivos ?? [] });
    } finally {
      setEnviando(false);
    }
  }

  const bloqueado = disabled || enviando;

  return (
    <article className={`card rec-${p.recomendacion}`}>
      <header className="card-head">
        <div>
          <strong>{p.msgId}</strong>
          <span className="muted"> · {p.clasificacion.tipo}</span>
        </div>
        <span className={`pill pill-${p.recomendacion}`}>{ETIQUETA[p.recomendacion]}</span>
      </header>

      <p className="card-sub">
        {p.correo.de} · “{p.correo.asunto}”
      </p>

      <div className="card-reco">
        <span className="muted">El agente recomienda:</span> <b>{ETIQUETA[p.recomendacion]}</b>
        {p.existenteId ? <span className="muted"> ({p.existenteId})</span> : null}
        <ul>
          {p.motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>

      {p.extraccion ? (
        <div className="fields">
          {CAMPOS.map(({ key, label, placeholder }) => {
            const conf = p.extraccion?.[key]?.confianza ?? 0;
            const tieneValor = original(key) !== "";
            const baja = tieneValor && conf < UMBRAL;
            const editado = key in correcciones;
            return (
              <label key={key} className={`field ${baja ? "low" : ""} ${editado ? "edited" : ""}`}>
                <span className="field-label">
                  {label}
                  {tieneValor ? (
                    <span className="conf">{Math.round(conf * 100)}%</span>
                  ) : (
                    <span className="conf">vacío</span>
                  )}
                </span>
                <input
                  value={valores[key]}
                  placeholder={placeholder}
                  disabled={bloqueado}
                  onChange={(e) => setValores((v) => ({ ...v, [key]: e.target.value }))}
                />
                {tieneValor ? (
                  <span className="bar">
                    <span style={{ width: `${Math.round(conf * 100)}%` }} />
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}

      <textarea
        className="comment"
        placeholder="Comentario (opcional): por qué apruebas o rechazas"
        value={comentario}
        disabled={bloqueado}
        onChange={(e) => setComentario(e.target.value)}
        rows={2}
      />

      {error ? (
        <div className="card-error">
          <b>{error.msg}</b>
          {error.motivos.length ? (
            <ul>
              {error.motivos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <footer className="card-actions">
        <button
          type="button"
          className="ghost danger"
          disabled={bloqueado}
          onClick={() => ejecutar(() => onRechazar(p.msgId, comentario))}
        >
          Rechazar
        </button>
        <button
          type="button"
          disabled={bloqueado}
          onClick={() => ejecutar(() => onAprobar(p.msgId, correcciones, comentario))}
        >
          {enviando ? "Aplicando…" : TEXTO_APROBAR[p.recomendacion]}
          {Object.keys(correcciones).length ? ` (${Object.keys(correcciones).length} corrección/es)` : ""}
        </button>
      </footer>
    </article>
  );
}

/** Tarjeta post-HITL: qué decidió el humano y qué se ejecutó. */
export function ResolucionCard({ propuesta: p }: { propuesta: Propuesta }) {
  const r = p.resolucion;
  if (!r) return null;
  const correcciones = Object.entries(r.correcciones ?? {});
  const cambios = Object.entries(r.cambios ?? {});
  return (
    <article className={`card resolved ${p.estado === "RECHAZADA" ? "is-rejected" : "is-approved"}`}>
      <header className="card-head">
        <div>
          <strong>{p.msgId}</strong>
          <span className="muted"> · {p.clasificacion.tipo}</span>
        </div>
        <span className={`pill ${p.estado === "RECHAZADA" ? "pill-RECHAZAR" : "pill-ok"}`}>
          {p.estado === "RECHAZADA" ? "Rechazada" : "Aprobada"}
        </span>
      </header>
      <p className="card-sub">
        Agente recomendó <b>{ETIQUETA[p.recomendacion]}</b> → {r.aprobador} decidió{" "}
        <b>{r.accion}</b> → se ejecutó <b>{r.decisionFinal}</b>
        {r.contratoId ? ` [${r.contratoId}]` : ""}
      </p>
      {correcciones.length ? (
        <p className="muted small">
          Correcciones: {correcciones.map(([k, v]) => `${k}=${v}`).join(", ")}
        </p>
      ) : null}
      {cambios.length ? (
        <p className="muted small">
          Cambios en maestro:{" "}
          {cambios.map(([k, c]) => `${k}: ${String(c.antes)} → ${String(c.despues)}`).join(" · ")}
        </p>
      ) : null}
      {r.comentario ? <p className="small">“{r.comentario}”</p> : null}
      <p className="muted small">{new Date(r.resueltaEn).toLocaleString("es-CO")}</p>
    </article>
  );
}
