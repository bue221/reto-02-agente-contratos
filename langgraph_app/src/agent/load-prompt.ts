/**
 * Carga system / help prompts desde prompts/*.md (editables sin tocar código).
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.ts";

function readPrompt(name: string): string {
  const cfg = loadConfig();
  const candidates = [
    path.join(cfg.appDir, "prompts", name),
    path.join(process.cwd(), "prompts", name),
    path.join(process.cwd(), "langgraph_app", "prompts", name),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  }
  throw new Error(`No se encontró prompts/${name}`);
}

let systemCache: string | null = null;
let helpCache: string | null = null;

export function loadAgentSystemPrompt(): string {
  if (!systemCache) systemCache = readPrompt("agent-system.md");
  return systemCache;
}

export function loadAgentHelpPrompt(): string {
  if (!helpCache) helpCache = readPrompt("agent-help.md");
  return helpCache;
}
