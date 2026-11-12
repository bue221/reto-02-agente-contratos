/**
 * Las mismas herramientas de la app, importables sin el servidor HTTP (PRD 9.4).
 * Cada export es `{ description, args, execute }`; el nombre que ve el modelo es `contratos_<export>`.
 */
export { alertas, ejecutarHerramienta, extraer, herramientas, leer_buzon, registrar, validar } from "../../src/tools/contratos.ts";
export type { ContextoHerramienta, Herramienta } from "../../src/tools/herramienta.ts";
