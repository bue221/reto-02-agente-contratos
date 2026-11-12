import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod/v3";
import { reiniciarDemo } from "../../api/src/application/use-cases/reset-demo.ts";
import { mensajeDeError } from "../../api/src/core/domain/result.ts";
import { rutasDelProyecto } from "../../api/src/infrastructure/paths.ts";
import { type DependenciasStudio, dependenciasPorEntorno } from "./project.ts";

/**
 * Reinicio de la demo desde Studio: el mismo `reiniciarDemo` que `POST /api/demo/reset`.
 * Es un grafo aparte y no una herramienta para que el modelo nunca pueda borrar `out/`.
 * Estado en zod, como los otros grafos, para que el servidor no compile TypeScript al pedir sus esquemas.
 *
 *   __start__ ─▶ reiniciar ─▶ __end__
 */

export const EstadoReinicio = z.object({
  mensajes: z.number().int().nullable().describe("Mensajes del buzón que quedan pendientes tras el reinicio"),
  error: z.string().nullable(),
});

export function crearGrafoReinicio(deps: Pick<DependenciasStudio, "directorio">) {
  async function reiniciar(): Promise<z.infer<typeof EstadoReinicio>> {
    try {
      return { mensajes: await reiniciarDemo(rutasDelProyecto(deps.directorio)), error: null };
    } catch (error) {
      return { mensajes: null, error: `no se pudo reiniciar out/: ${mensajeDeError(error)}` };
    }
  }

  return new StateGraph({ state: EstadoReinicio, input: z.object({}) })
    .addNode("reiniciar", reiniciar)
    .addEdge(START, "reiniciar")
    .addEdge("reiniciar", END);
}

export const graph = crearGrafoReinicio(dependenciasPorEntorno()).compile();
