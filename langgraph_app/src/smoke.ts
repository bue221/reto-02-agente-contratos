import { HumanMessage } from "@langchain/core/messages";
import { graph as agente } from "./chat-graph.ts";
import { getPropuestas, resetDeps } from "./deps.ts";
import { graph as pipeline } from "./graph.ts";
import { formatearPropuesta } from "./hitl/format.ts";

resetDeps();

console.log("=== PIPELINE (recomendaciones, sin ejecutar) ===\n");
for (const msgId of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005", "msg-006"]) {
  await pipeline.invoke({ msgId });
  console.log(formatearPropuesta(getPropuestas().get(msgId)!) + "\n");
}

console.log("=== CHAT (agente) ===\n");
const chat = await agente.invoke({
  messages: [new HumanMessage("qué tengo por aprobar")],
});
const last = chat.messages.at(-1);
const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
console.log(text?.slice(0, 1200));
console.log("\nOK");
