import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveRepoRoot(): string {
  const candidates = [
    // Studio/CLI suele arrancar con cwd = langgraph_app
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd()),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "fixtures", "reto-02", "buzon"))) {
      return candidate;
    }
  }
  throw new Error(
    "No se encontró fixtures/reto-02. Ejecuta Studio desde langgraph_app o define ROOT_DIR.",
  );
}

const ROOT = process.env.ROOT_DIR ? path.resolve(process.env.ROOT_DIR) : resolveRepoRoot();
const APP_DIR = path.join(ROOT, "langgraph_app");
const FIXTURES = path.join(ROOT, "fixtures", "reto-02");

export type LlmProviderEnv = "gemini" | "offline" | "openai" | "anthropic" | "auto";

export interface Config {
  root: string;
  appDir: string;
  buzonDir: string;
  masterSeed: string;
  comercialesPath: string;
  outDir: string;
  hoy: string;
  umbralConfianza: number;
  geminiModel: string;
  /** Preferencia de proveedor; "auto" elige Gemini si hay key. */
  llmProvider: LlmProviderEnv;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const raw = (process.env.LLM_PROVIDER ?? "auto").trim().toLowerCase();
  const llmProvider: LlmProviderEnv =
    raw === "gemini" || raw === "offline" || raw === "openai" || raw === "anthropic"
      ? raw
      : "auto";

  return {
    root: ROOT,
    appDir: APP_DIR,
    buzonDir: path.join(FIXTURES, "buzon"),
    masterSeed: path.join(FIXTURES, "maestro-contratos.csv"),
    comercialesPath: path.join(FIXTURES, "comerciales.json"),
    outDir: process.env.OUT_DIR ?? path.join(ROOT, "output-langgraph"),
    hoy: process.env.REFERENCE_DATE ?? "2026-05-30",
    umbralConfianza: Number(process.env.CONFIDENCE_THRESHOLD ?? "0.8"),
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    llmProvider,
    ...overrides,
  };
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GOOGLE_API_KEY?.trim());
}
