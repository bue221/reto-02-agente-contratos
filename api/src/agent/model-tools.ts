import { z } from "zod";
import type { DefinicionHerramienta } from "../llm/adapter.ts";
import { herramientas } from "../tools/contratos.ts";

/** Lo que ve el modelo de cada herramienta: nombre, la frase de `description` y el JSON Schema de sus `args` zod. */
export function definicionesParaModelo(): DefinicionHerramienta[] {
  return Object.entries(herramientas).map(([nombre, herramienta]) => ({
    nombre,
    descripcion: herramienta.description,
    // `io: "input"` deja como opcionales los campos con valor por defecto (p. ej. `confirmado`).
    parametros: z.toJSONSchema(z.object(herramienta.args), { io: "input" }) as Record<string, unknown>,
  }));
}
