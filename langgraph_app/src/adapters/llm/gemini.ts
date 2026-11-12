/**
 * Adapter Gemini (LangChain ChatGoogle) para clasificar/extraer.
 * Si falla → null; el factory cae al heurístico.
 */
import { ChatGoogle } from "@langchain/google/node";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { hasGeminiKey, loadConfig } from "../../config.ts";
import {
  ClasificacionLlmSchema,
  ExtraccionLlmSchema,
  type CampoLlm,
} from "../../domain/schemas.ts";
import type { Clasificacion, Correo, Extraccion, Tipo } from "../../domain/types.ts";
import type { ChatLlmPort, DocumentLlmPort } from "../../ports/llm.ts";

function campoStr(campo: CampoLlm) {
  const raw = (campo.valor ?? "").trim();
  return {
    valor: raw === "" ? null : raw,
    confianza: campo.confianza,
    evidencia: campo.evidencia || undefined,
  };
}

function campoNum(campo: CampoLlm) {
  const raw = (campo.valor ?? "").trim();
  if (!raw) {
    return {
      valor: null as number | null,
      confianza: campo.confianza,
      evidencia: campo.evidencia || undefined,
    };
  }
  const n = Number(raw.replace(/\./g, "").replace(/,/g, ""));
  return {
    valor: Number.isFinite(n) ? n : null,
    confianza: campo.confianza,
    evidencia: campo.evidencia || undefined,
  };
}

export class GeminiDocumentLlm implements DocumentLlmPort {
  readonly id = "gemini";
  private modelCache: ChatGoogle | null = null;
  private usable: boolean | null = null;

  private getModel(): ChatGoogle | null {
    if (!hasGeminiKey() || process.env.GEMINI_FORCE_OFFLINE === "1") return null;
    if (!this.modelCache) {
      const cfg = loadConfig();
      this.modelCache = new ChatGoogle({
        model: cfg.geminiModel,
        apiKey: process.env.GOOGLE_API_KEY,
        temperature: 0,
      });
    }
    return this.modelCache;
  }

  async probe(): Promise<boolean> {
    if (this.usable !== null) return this.usable;
    const model = this.getModel();
    if (!model) {
      this.usable = false;
      return false;
    }
    try {
      await model.invoke("Responde solo: ok");
      this.usable = true;
    } catch (e) {
      console.warn(`[llm:gemini] no usable: ${(e as Error).message.slice(0, 160)}`);
      this.usable = false;
    }
    return this.usable;
  }

  isActive(): boolean {
    return this.usable === true;
  }

  async clasificar(correo: Correo): Promise<Clasificacion | null> {
    const model = this.getModel();
    if (!model || !(await this.probe())) return null;

    const prompt = `Clasifica este correo del buzón de contratos.

Tipos válidos:
- contrato: contrato nuevo a registrar
- otrosi: otrosí / prórroga / modificación de vigencia
- actualizacion: nueva versión de un contrato ya existente (cambia valor u otros datos)
- cotizacion: cotización / propuesta comercial (NO es contrato)
- otro: no encaja

Correo:
De: ${correo.de}
Fecha: ${correo.fecha}
Asunto: ${correo.asunto}
Cuerpo: ${correo.cuerpo}
Adjuntos: ${correo.adjuntos.map((a) => a.nombre).join(", ") || "(ninguno)"}
Primeras líneas del adjunto:
${(correo.adjuntos[0]?.texto ?? "").slice(0, 500)}

Devuelve tipo, confianza 0..1 y razón breve.`;

    try {
      const structured = model.withStructuredOutput(ClasificacionLlmSchema);
      return (await structured.invoke(prompt)) as Clasificacion;
    } catch (e) {
      console.warn(`[llm:gemini] clasificar falló: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  }

  async extraer(texto: string, tipo: Tipo): Promise<Extraccion | null> {
    const model = this.getModel();
    if (!model || !(await this.probe())) return null;

    const prompt = `Extrae datos de este documento de tipo "${tipo}".

Reglas:
- Cada campo: valor (string; vacío si no aparece), confianza 0..1, evidencia.
- Fechas en ISO yyyy-mm-dd. Si la fecha es vaga ("a finales de diciembre"), estima último día del mes con confianza BAJA (<=0.45).
- Valor numérico en COP sin símbolos (ej. "120000000").
- NIT con formato 900.111.222-3 si aparece así.
- idContrato solo si aparece (C-001); si no, valor "".

Documento:
---
${texto.slice(0, 4000)}
---`;

    try {
      const structured = model.withStructuredOutput(ExtraccionLlmSchema);
      const out = await structured.invoke(prompt);
      return {
        idContrato: campoStr(out.idContrato),
        cliente: campoStr(out.cliente),
        nit: campoStr(out.nit),
        valor: campoNum(out.valor),
        fechaInicio: campoStr(out.fechaInicio),
        fechaFin: campoStr(out.fechaFin),
      };
    } catch (e) {
      console.warn(`[llm:gemini] extraer falló: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  }
}

export class GeminiChatLlm implements ChatLlmPort {
  readonly id = "gemini";

  createChatModel(): BaseChatModel | null {
    if (!hasGeminiKey() || process.env.GEMINI_FORCE_OFFLINE === "1") return null;
    const cfg = loadConfig();
    return new ChatGoogle({
      model: cfg.geminiModel,
      apiKey: process.env.GOOGLE_API_KEY,
      temperature: 0,
    });
  }
}
