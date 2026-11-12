/**
 * Las herramientas que ve el agente en la app (la recepcionista), importables sin el servidor HTTP (PRD 9.4).
 * Cada export es `{ description, args, execute }`; el nombre que ve el modelo es `recepcion_<export>`.
 * Por debajo encienden el motor determinista, que llama a las de `contratos.ts`.
 */
export {
  consultar_estado,
  consultar_maestro,
  ejecutarHerramienta,
  explicar_validacion,
  herramientas,
  procesar_buzon,
  responder_revision,
} from "../../api/src/tools/recepcion.ts";
export type { ContextoHerramienta, Herramienta } from "../../api/src/tools/tool.ts";
