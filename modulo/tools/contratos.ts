/**
 * Las mismas herramientas de la app, importables sin el servidor HTTP (PRD 9.4).
 * Cada export es `{ description, args, execute }`; el nombre es `contratos_<export>`.
 * En la app las llama el motor determinista; el agente las enciende con las de `recepcion.ts`.
 */
export { alertas, ejecutarHerramienta, extraer, herramientas, leer_buzon, registrar, validar } from "../../api/src/tools/contratos.ts";
export type { ContextoHerramienta, Herramienta } from "../../api/src/tools/tool.ts";
