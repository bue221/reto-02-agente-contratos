import type { Deps } from "../pipeline/index.ts";
import { crearHerramientas } from "./tools.ts";
import type { Herramienta } from "./tools.ts";

const AYUDA = `Puedo ayudarte con:
  • "procesa el buzón"            → procesa todos los mensajes
  • "procesa msg-003"             → procesa un mensaje
  • "qué contratos vencen"        → reporte de alertas de vencimiento
  • "consulta C-001"              → ver un contrato del maestro
  • "lista los mensajes"          → ver el buzón
  • "reinicia"                    → volver al estado original
  • "salir"`;

const SYSTEM = `Eres el agente de recepción de contratos. Atiendes en español, de forma breve y clara.
Usa SIEMPRE las herramientas para procesar mensajes, consultar contratos o generar reportes: nunca inventes resultados.
Cuando una herramienta devuelva el detalle de un caso, resúmelo y explica el motivo de la decisión (nuevo, actualización, duplicado, rechazo o revisión humana).
No tomes decisiones de negocio por tu cuenta: las reglas las aplica el sistema.`;

export type Responder = (texto: string) => Promise<string>;

export function crearChat(deps: Deps): Responder {
  const tools = crearHerramientas(deps);
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? chatConClaude(key, tools) : chatLocal(tools);
}

// ───────── Modo offline: enrutador por intención (sin LLM) ─────────
function chatLocal(tools: Herramienta[]): Responder {
  const t = (n: string) => tools.find((x) => x.name === n)!;
  return async (texto) => {
    const s = texto.toLowerCase();
    const msg = s.match(/msg-?(\d{1,3})/);
    const contrato = texto.match(/\bC-?(\d{1,3})\b/i);
    if (/ayuda|help|qué puedes|que puedes/.test(s)) return AYUDA;
    if (/reinici|reset|restablec/.test(s)) return t("reiniciar_demo").run({});
    if (msg) return t("procesar_mensaje").run({ id: `msg-${msg[1].padStart(3, "0")}` });
    if (/proces\w*.*(buz|todo)|buz[oó]n.*proces/.test(s)) return t("procesar_buzon").run({});
    if (/venc|alerta|reporte/.test(s)) return t("reporte_vencimientos").run({});
    if (contrato) return t("consultar_contrato").run({ id: `C-${contrato[1].padStart(3, "0")}` });
    if (/list|mensajes|buz/.test(s)) return t("listar_mensajes").run({});
    return `No entendí. ${AYUDA}`;
  };
}

// ───────── Modo con Claude: bucle de tool calling ─────────
function chatConClaude(apiKey: string, tools: Herramienta[]): Responder {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const historial: any[] = [];

  const llamar = async () => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model, max_tokens: 1500, system: SYSTEM, messages: historial,
        tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as any;
  };

  return async (texto) => {
    historial.push({ role: "user", content: texto });
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      const data = await llamar();
      historial.push({ role: "assistant", content: data.content });
      const usos = (data.content as any[]).filter((b) => b.type === "tool_use");
      if (data.stop_reason !== "tool_use" || usos.length === 0) {
        return (data.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      }
      const resultados = [];
      for (const u of usos) {
        const tool = tools.find((x) => x.name === u.name);
        let out: string;
        try { out = tool ? await tool.run(u.input) : `Herramienta desconocida: ${u.name}`; }
        catch (e) { out = `Error: ${(e as Error).message}`; }
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      historial.push({ role: "user", content: resultados });
    }
    return "Se alcanzó el máximo de pasos sin una respuesta final.";
  };
}
