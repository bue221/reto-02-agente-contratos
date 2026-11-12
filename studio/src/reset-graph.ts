import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { reiniciarDemo } from "../../api/src/application/use-cases/reset-demo.ts";
import { mensajeDeError } from "../../api/src/core/domain/result.ts";
import { rutasDelProyecto } from "../../api/src/infrastructure/paths.ts";
import { type DependenciasStudio, dependenciasPorEntorno } from "./project.ts";

/**
 * Reinicio de la demo desde Studio (solo desarrollo): el mismo `reiniciarDemo` que `POST /api/demo/reset`.
 * Es un grafo aparte y no una herramienta para que el modelo nunca pueda borrar `out/`.
 *
 *   __start__ ─▶ reiniciar ─▶ __end__
 */

export const EstadoReinicio = Annotation.Root({
  /** Mensajes del buzón que quedan pendientes tras el reinicio. */
  mensajes: Annotation<number | null>,
  error: Annotation<string | null>,
});

export function crearGrafoReinicio(deps: Pick<DependenciasStudio, "directorio">) {
  async function reiniciar(): Promise<typeof EstadoReinicio.Update> {
    try {
      return { mensajes: await reiniciarDemo(rutasDelProyecto(deps.directorio)), error: null };
    } catch (error) {
      return { mensajes: null, error: `no se pudo reiniciar out/: ${mensajeDeError(error)}` };
    }
  }

  return new StateGraph(EstadoReinicio).addNode("reiniciar", reiniciar).addEdge(START, "reiniciar").addEdge("reiniciar", END);
}

export const graph = crearGrafoReinicio(dependenciasPorEntorno()).compile();
