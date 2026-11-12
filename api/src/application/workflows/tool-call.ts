import type { Resultado } from "../../core/domain/result.ts";
import { ejecutarHerramienta, resumirEjecucion } from "../../tools/contratos.ts";
import type { ContextoHerramienta } from "../../tools/tool.ts";

/**
 * Única puerta del motor hacia las herramientas `contratos_*`: valida con zod, deja `out/log.jsonl`
 * y, si el contexto trae `traza` o `alPaso`, anota la llamada para que el chat la muestre anidada y en vivo.
 */
export async function llamarHerramienta<T>(nombre: string, args: Record<string, unknown>, ctx: ContextoHerramienta): Promise<Resultado<T>> {
  const json = await ejecutarHerramienta(nombre, args, ctx);
  // Las herramientas devuelven JSON propio con forma `Resultado<T>`; el tipo lo fija quien llama.
  const resultado = JSON.parse(json) as Resultado<T>;
  const paso = { nombre, args, ok: resultado.ok, resumen: resultado.ok ? resumirEjecucion(nombre, json) : resultado.error };
  ctx.traza?.push(paso);
  ctx.alPaso?.(paso);
  return resultado;
}
