import { type Resultado, exito } from "../core/domain/result.ts";
import type { DefinicionHerramienta, MensajeLlm, ProveedorLlm, RespuestaLlm } from "./adapter.ts";
import { siguientePaso } from "./offline/script.ts";

/**
 * Proveedor sin modelo: recorre las herramientas con un guion determinista (PRD 11) para probar
 * la app completa sin clave. Reporta 0 tokens porque no consume ningún servicio.
 */
export class ProveedorOffline implements ProveedorLlm {
  readonly nombre = "offline";
  readonly modelo = "guion-determinista";

  async enviar(mensajes: readonly MensajeLlm[], _herramientas: readonly DefinicionHerramienta[]): Promise<Resultado<RespuestaLlm>> {
    const paso = siguientePaso(mensajes);
    const uso = { entrada: 0, salida: 0 };
    if (paso.tipo === "responder") return exito({ texto: paso.texto, llamadas: [], uso });
    const previas = mensajes.filter((mensaje) => mensaje.rol === "herramienta").length;
    const llamadas = paso.llamadas.map((llamada, indice) => ({ id: `offline-${previas + indice}`, ...llamada }));
    return exito({ texto: "", llamadas, uso });
  }
}
