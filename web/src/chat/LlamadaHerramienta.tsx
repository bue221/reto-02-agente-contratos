import type { LlamadaVisible } from "../api";

/** Cada llamada a herramienta visible en el chat (CA4): nombre, estado, resumen y argumentos desplegables. */
export function LlamadaHerramienta({ llamada }: { llamada: LlamadaVisible }) {
  const mensajeId = typeof llamada.args.mensaje_id === "string" ? llamada.args.mensaje_id : null;
  const confirmado = llamada.args.confirmado === true;
  return (
    <details className={`llamada ${llamada.ok ? "ok" : "error"}`}>
      <summary>
        <span className={`estado ${llamada.ok ? "ok" : "error"}`}>{llamada.ok ? "ok" : "error"}</span>
        <code className="nombre">{llamada.nombre}</code>
        {mensajeId && <span className="etiqueta">{mensajeId}</span>}
        {confirmado && <span className="etiqueta confirmado">confirmado</span>}
        <span className="resumen">{llamada.resumen}</span>
      </summary>
      <pre>{JSON.stringify(llamada.args, null, 2)}</pre>
    </details>
  );
}

export function ListaDeLlamadas({ llamadas }: { llamadas: readonly LlamadaVisible[] }) {
  if (llamadas.length === 0) return null;
  const errores = llamadas.filter((llamada) => !llamada.ok).length;
  return (
    <details className="llamadas" open>
      <summary>
        {llamadas.length} llamadas a herramientas{errores > 0 ? ` · ${errores} con error` : ""}
      </summary>
      {llamadas.map((llamada, i) => (
        <LlamadaHerramienta key={i} llamada={llamada} />
      ))}
    </details>
  );
}
