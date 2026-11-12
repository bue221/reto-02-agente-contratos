/**
 * Grafo `pipeline` — el agente ANALIZA y RECOMIENDA.
 *
 * Termina en `proponer`: guarda una tarjeta pendiente de aprobación humana.
 * Nada se escribe en el maestro aquí; eso solo ocurre en el grafo `resolucion`
 * cuando un humano aprueba (ver hitl/resolucion-graph.ts).
 *
 * Input en Studio: { "msgId": "msg-001" }
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { proponer } from "./hitl/nodes.ts";
import {
  buscarExistente,
  cargar,
  clasificar,
  decidir,
  extraer,
  resolverAutoria,
  rutaTrasClasificar,
  validar,
} from "./nodes.ts";
import { PipelineAnnotation, PipelineInputAnnotation } from "./state.ts";

const builder = new StateGraph(PipelineAnnotation, {
  input: PipelineInputAnnotation,
})
  .addNode("cargar", cargar)
  .addNode("clasificar", clasificar)
  .addNode("extraer", extraer)
  .addNode("resolver_autoria", resolverAutoria)
  .addNode("buscar_existente", buscarExistente)
  .addNode("validar", validar)
  .addNode("recomendar", decidir)
  .addNode("proponer", proponer)
  .addEdge(START, "cargar")
  .addEdge("cargar", "clasificar")
  .addConditionalEdges("clasificar", rutaTrasClasificar, [
    "extraer",
    "resolver_autoria",
  ])
  .addEdge("extraer", "resolver_autoria")
  .addEdge("resolver_autoria", "buscar_existente")
  .addEdge("buscar_existente", "validar")
  .addEdge("validar", "recomendar")
  .addEdge("recomendar", "proponer")
  .addEdge("proponer", END);

export const graph = builder.compile();
