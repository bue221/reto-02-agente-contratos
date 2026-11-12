import type { LlamadaEnCurso, ProgresoTurno } from "../lib/turn-progress";
import { ToolCall } from "./ToolCallList";

function LlamadaActiva({ llamada }: { llamada: LlamadaEnCurso }) {
  return (
    <details className="llamada en-curso" open>
      <summary>
        <span className="estado en-curso">en curso</span>
        <code className="nombre">{llamada.nombre}</code>
        {llamada.pasos.length > 0 && <span className="etiqueta">motor: {llamada.pasos.length} pasos</span>}
      </summary>
      {llamada.pasos.length > 0 && (
        <div className="pasos-motor">
          {llamada.pasos.map((paso, i) => (
            <ToolCall key={i} llamada={paso} />
          ))}
        </div>
      )}
    </details>
  );
}

/** El turno mientras corre (streaming): cada herramienta y cada paso del motor aparecen apenas terminan. */
export function TurnProgress({ progreso }: { progreso: ProgresoTurno }) {
  return (
    <div className="llamadas progreso-turno">
      {progreso.llamadas.map((llamada, i) => (llamada.final ? <ToolCall key={i} llamada={llamada.final} /> : <LlamadaActiva key={i} llamada={llamada} />))}
      <div className="pensando" role="status">
        <span className="punto" />
        <span className="punto" />
        <span className="punto" />
        {progreso.estado}
      </div>
    </div>
  );
}
