import type { Clasificacion, Correo, Extraccion, Tipo } from "../types.ts";
import { normalizarClasificacion, normalizarExtraccion } from "./index.ts";
import type { LLM } from "./index.ts";

async function llamar(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

function parseJson(texto: string): unknown {
  return JSON.parse(texto.replace(/```json|```/g, "").trim());
}

const SYS_CLASIFICAR = `Eres un clasificador de correos de un área de contratos. Responde SOLO con JSON, sin texto adicional ni backticks:
{"tipo": "contrato" | "otrosi" | "actualizacion" | "cotizacion" | "otro", "confianza": 0..1, "razon": "frase corta"}
- contrato: contrato nuevo firmado.
- otrosi: modificación de un contrato existente (prórroga, cambio de valor).
- actualizacion: nueva versión de un contrato que ya existe en el maestro (referencia su id C-###).
- cotizacion: oferta comercial, NO es un contrato.
- otro: cualquier otra cosa.`;

const SYS_EXTRAER = `Extrae datos de un documento contractual en español. Responde SOLO con JSON, sin texto adicional ni backticks, con esta forma:
{"idContrato":{"valor":string|null,"confianza":0..1,"evidencia":string},
 "cliente":{...},"nit":{...},"valor":{"valor":number|null,...},
 "fechaInicio":{"valor":"YYYY-MM-DD"|null,...},"fechaFin":{"valor":"YYYY-MM-DD"|null,...}}
Reglas: NO inventes. Si un dato no aparece, usa valor null y confianza 0. Si el dato es ambiguo o aproximado
(ej. "a finales de diciembre"), da tu mejor estimación con confianza <= 0.5. "valor" es un número en pesos sin separadores.
"evidencia" es el fragmento literal del documento que usaste.`;

export function anthropicLLM(apiKey: string, model: string): LLM {
  return {
    nombre: `anthropic:${model}`,
    async clasificar(c: Correo): Promise<Clasificacion> {
      const adj = c.adjuntos.map((a) => `--- adjunto ${a.nombre} ---\n${a.texto.slice(0, 1500)}`).join("\n");
      const user = `Asunto: ${c.asunto}\nCuerpo: ${c.cuerpo}\n${adj}`;
      return normalizarClasificacion(parseJson(await llamar(apiKey, model, SYS_CLASIFICAR, user)));
    },
    async extraer(texto: string, tipo: Tipo): Promise<Extraccion> {
      const user = `Tipo de documento: ${tipo}\n\n${texto}`;
      return normalizarExtraccion(parseJson(await llamar(apiKey, model, SYS_EXTRAER, user)));
    },
  };
}
