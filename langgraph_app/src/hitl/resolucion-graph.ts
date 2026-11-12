/**
 * Grafo `resolucion` — lo dispara SOLO un humano (tarjeta del frontend o Studio).
 *
 * aprobar:  cargar_propuesta → aplicar_correcciones → buscar_existente → validar
 *           → decidir → ejecutar_* | bloquear
 * rechazar: cargar_propuesta → ejecutar_rechazo_humano
 *
 * Input en Studio:
 *   { "msgId": "msg-006", "accion": "aprobar", "correcciones": { "fechaFin": "2026-12-31" } }
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import {
  buscarExistente,
  decidir,
  ejecutarActualizar,
  ejecutarDuplicado,
  ejecutarRechazar,
  ejecutarRegistrar,
  validar,
} from "../nodes.ts";
import { ResolucionAnnotation, ResolucionInputAnnotation } from "../state.ts";
import {
  aplicarCorrecciones,
  auditarResolucion,
  bloquear,
  cargarPropuesta,
  ejecutarRechazoHumano,
  rutaResolucion,
  rutaTrasCargar,
} from "./nodes.ts";

const builder = new StateGraph(ResolucionAnnotation, {
  input: ResolucionInputAnnotation,
})
  .addNode("cargar_propuesta", cargarPropuesta)
  .addNode("aplicar_correcciones", aplicarCorrecciones)
  .addNode("buscar_existente", buscarExistente)
  .addNode("validar", validar)
  .addNode("decidir", decidir)
  .addNode("ejecutar_registrar", ejecutarRegistrar)
  .addNode("ejecutar_actualizar", ejecutarActualizar)
  .addNode("ejecutar_duplicado", ejecutarDuplicado)
  .addNode("ejecutar_rechazar", ejecutarRechazar)
  .addNode("ejecutar_rechazo_humano", ejecutarRechazoHumano)
  .addNode("bloquear", bloquear)
  .addNode("auditar_resolucion", auditarResolucion)
  .addEdge(START, "cargar_propuesta")
  .addConditionalEdges("cargar_propuesta", rutaTrasCargar, [
    "aplicar_correcciones",
    "ejecutar_rechazo_humano",
  ])
  .addEdge("aplicar_correcciones", "buscar_existente")
  .addEdge("buscar_existente", "validar")
  .addEdge("validar", "decidir")
  .addConditionalEdges("decidir", rutaResolucion, [
    "ejecutar_registrar",
    "ejecutar_actualizar",
    "ejecutar_duplicado",
    "ejecutar_rechazar",
    "bloquear",
  ])
  .addEdge("ejecutar_registrar", "auditar_resolucion")
  .addEdge("ejecutar_actualizar", "auditar_resolucion")
  .addEdge("ejecutar_duplicado", "auditar_resolucion")
  .addEdge("ejecutar_rechazar", "auditar_resolucion")
  .addEdge("ejecutar_rechazo_humano", "auditar_resolucion")
  .addEdge("bloquear", END)
  .addEdge("auditar_resolucion", END);

export const graph = builder.compile();
