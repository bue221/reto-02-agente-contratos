import { z } from "zod";
import type { DefinicionHerramienta } from "../llm/adapter.ts";
import { herramientas } from "../tools/recepcion.ts";

/**
 * Lo que ve el modelo: solo las herramientas de la recepcionista (`recepcion_*`), con la frase de `description`
 * y el JSON Schema de sus `args` zod. Las `contratos_*` las llama el motor determinista, nunca el modelo.
 */
export function definicionesParaModelo(): DefinicionHerramienta[] {
  return Object.entries(herramientas).map(([nombre, herramienta]) => ({
    nombre,
    descripcion: herramienta.description,
    // `io: "input"` deja como opcionales los campos con valor por defecto (p. ej. `correcciones`).
    parametros: z.toJSONSchema(z.object(herramienta.args), { io: "input" }) as Record<string, unknown>,
  }));
}
