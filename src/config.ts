import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface Config {
  root: string;
  buzonDir: string;
  masterSeed: string;
  comercialesPath: string;
  outDir: string;
  /** Fecha "de hoy" para alertas. El maestro está congelado al 2026-05-30, por eso no usamos new Date(). */
  hoy: string;
  umbralConfianza: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const fixtures = path.join(ROOT, "fixtures", "reto-02");
  return {
    root: ROOT,
    buzonDir: path.join(fixtures, "buzon"),
    masterSeed: path.join(fixtures, "maestro-contratos.csv"),
    comercialesPath: path.join(fixtures, "comerciales.json"),
    outDir: process.env.OUT_DIR ?? path.join(ROOT, "output"),
    hoy: process.env.REFERENCE_DATE ?? "2026-05-30",
    umbralConfianza: Number(process.env.CONFIDENCE_THRESHOLD ?? 0.8),
    ...overrides,
  };
}
