import type { EventoTurno, LlamadaVisible } from "./api";

/** Lo que se ve del turno mientras corre: el estado actual y cada herramienta con los pasos del motor que ya terminaron. */

export interface LlamadaEnCurso {
  nombre: string;
  args: Record<string, unknown>;
  pasos: LlamadaVisible[];
  /** La llamada terminada, con su resultado; `null` mientras corre. */
  final: LlamadaVisible | null;
}

export interface ProgresoTurno {
  estado: string;
  llamadas: LlamadaEnCurso[];
}

export const PROGRESO_INICIAL: ProgresoTurno = { estado: "Revisando tu mensaje…", llamadas: [] };

const mensajeIdDe = (args: Record<string, unknown>): string => (typeof args.mensaje_id === "string" ? ` · ${args.mensaje_id}` : "");

/** Reemplaza la última llamada (la que está corriendo); los eventos llegan en orden. */
function conUltima(llamadas: readonly LlamadaEnCurso[], cambio: (llamada: LlamadaEnCurso) => LlamadaEnCurso): LlamadaEnCurso[] {
  const ultima = llamadas.at(-1);
  return ultima ? [...llamadas.slice(0, -1), cambio(ultima)] : [...llamadas];
}

export function aplicarEvento(progreso: ProgresoTurno, evento: EventoTurno): ProgresoTurno {
  switch (evento.tipo) {
    case "modelo":
      return { ...progreso, estado: evento.iteracion === 1 ? "El modelo está pensando…" : `El modelo revisa los resultados (iteración ${evento.iteracion})…` };
    case "herramienta":
      return { estado: `Ejecutando ${evento.nombre}…`, llamadas: [...progreso.llamadas, { nombre: evento.nombre, args: evento.args, pasos: [], final: null }] };
    case "paso":
      return {
        estado: `Motor: ${evento.paso.nombre}${mensajeIdDe(evento.paso.args)} listo…`,
        llamadas: conUltima(progreso.llamadas, (llamada) => ({ ...llamada, pasos: [...llamada.pasos, evento.paso] })),
      };
    case "resultado":
      return { estado: `${evento.llamada.nombre} terminó; el modelo prepara la respuesta…`, llamadas: conUltima(progreso.llamadas, (llamada) => ({ ...llamada, final: evento.llamada })) };
  }
}
