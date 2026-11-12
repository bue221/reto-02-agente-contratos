import type { LlamadaVisible } from "../lib/api";

/**
 * Cada llamada a herramienta visible en el chat (CA4): nombre, estado, resumen y argumentos desplegables.
 * Las llamadas de la recepcionista muestran debajo las `contratos_*` que ejecutó el motor determinista.
 */
export function ToolCall({ llamada }: { llamada: LlamadaVisible }) {
  const mensajeId = typeof llamada.args.mensaje_id === "string" ? llamada.args.mensaje_id : null;
  const confirmado = llamada.args.confirmado === true;
  const decision = typeof llamada.args.decision === "string" ? llamada.args.decision : null;
  const pasos = llamada.pasos ?? [];
  return (
    <details className={`llamada ${llamada.ok ? "ok" : "error"}`}>
      <summary>
        <span className={`estado ${llamada.ok ? "ok" : "error"}`}>{llamada.ok ? "ok" : "error"}</span>
        <code className="nombre">{llamada.nombre}</code>
        {mensajeId && <span className="etiqueta">{mensajeId}</span>}
        {(confirmado || decision) && <span className="etiqueta confirmado">{decision ?? "confirmado"}</span>}
        {pasos.length > 0 && <span className="etiqueta">motor: {pasos.length} pasos</span>}
        <span className="resumen">{llamada.resumen}</span>
      </summary>
      <pre>{JSON.stringify(llamada.args, null, 2)}</pre>
      {pasos.length > 0 && (
        <div className="pasos-motor">
          {pasos.map((paso, i) => (
            <ToolCall key={i} llamada={paso} />
          ))}
        </div>
      )}
    </details>
  );
}

export function ToolCallList({ llamadas }: { llamadas: readonly LlamadaVisible[] }) {
  if (llamadas.length === 0) return null;
  const errores = llamadas.filter((llamada) => !llamada.ok).length;
  const pasos = llamadas.reduce((total, llamada) => total + (llamada.pasos?.length ?? 0), 0);
  return (
    <details className="llamadas" open>
      <summary>
        {llamadas.length} llamadas a herramientas{pasos > 0 ? ` · ${pasos} pasos del motor` : ""}
        {errores > 0 ? ` · ${errores} con error` : ""}
      </summary>
      {llamadas.map((llamada, i) => (
        <ToolCall key={i} llamada={llamada} />
      ))}
    </details>
  );
}
