/**
 * Stubs para OpenAI / Anthropic: mismo puerto ChatLlmPort.
 * Instala el paquete LangChain correspondiente y completa createChatModel.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatLlmPort } from "../../ports/llm.ts";

export class OpenAiChatStub implements ChatLlmPort {
  readonly id = "openai";

  createChatModel(): BaseChatModel | null {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      console.warn("[llm:openai] OPENAI_API_KEY ausente → offline");
      return null;
    }
    console.warn(
      "[llm:openai] Stub: instala @langchain/openai y reemplaza OpenAiChatStub.createChatModel",
    );
    return null;
  }
}

export class AnthropicChatStub implements ChatLlmPort {
  readonly id = "anthropic";

  createChatModel(): BaseChatModel | null {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      console.warn("[llm:anthropic] ANTHROPIC_API_KEY ausente → offline");
      return null;
    }
    console.warn(
      "[llm:anthropic] Stub: instala @langchain/anthropic y reemplaza AnthropicChatStub.createChatModel",
    );
    return null;
  }
}
