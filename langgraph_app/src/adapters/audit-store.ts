import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import type {
  AuditConfidenceSummary,
  AuditRecord,
  AuditStore,
} from "../ports/audit.ts";
import type { Campo } from "../types.ts";

function auditPath(cfg: Config): string {
  return path.join(cfg.outDir, "auditoria.jsonl");
}

function confianzasDeExtraccion(
  extraccion: AuditRecord["extraccion"],
): Array<{ campo: string; valor: unknown; confianza: number }> {
  if (!extraccion) return [];
  const out: Array<{ campo: string; valor: unknown; confianza: number }> = [];
  for (const [campo, raw] of Object.entries(extraccion)) {
    const c = raw as Campo<unknown> | undefined;
    if (!c || typeof c.confianza !== "number") continue;
    out.push({ campo, valor: c.valor ?? null, confianza: c.confianza });
  }
  return out;
}

export class JsonlAuditStore implements AuditStore {
  constructor(private readonly cfg: Config) {}

  append(record: AuditRecord): void {
    fs.mkdirSync(this.cfg.outDir, { recursive: true });
    fs.appendFileSync(auditPath(this.cfg), JSON.stringify(record) + "\n");
  }

  list(limit = 50): AuditRecord[] {
    const p = auditPath(this.cfg);
    if (!fs.existsSync(p)) return [];
    const lines = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: AuditRecord[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as AuditRecord);
      } catch {
        /* línea corrupta: skip */
      }
    }
    return parsed.slice(-Math.max(1, limit));
  }

  forMsg(msgId: string): AuditRecord[] {
    const id = msgId.trim().toLowerCase();
    return this.list(Number.MAX_SAFE_INTEGER).filter(
      (r) => String(r.msgId).toLowerCase() === id,
    );
  }

  last(msgId?: string): AuditRecord | null {
    const all = this.list(500);
    if (!all.length) return null;
    if (!msgId) return all[all.length - 1] ?? null;
    const id = msgId.trim().toLowerCase();
    for (let i = all.length - 1; i >= 0; i--) {
      if (String(all[i]!.msgId).toLowerCase() === id) return all[i]!;
    }
    return null;
  }

  summarize(record: AuditRecord): AuditConfidenceSummary {
    const campos = confianzasDeExtraccion(record.extraccion);
    const vals = campos.map((c) => c.confianza);
    const confianzaMin = vals.length ? Math.min(...vals) : null;
    const confianzaMedia = vals.length
      ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3))
      : null;
    return {
      msgId: record.msgId,
      ts: record.ts,
      fase: record.fase ?? null,
      decision: record.decision ? String(record.decision) : null,
      tipo: record.tipo ? String(record.tipo) : null,
      contratoId: record.contratoId ?? null,
      modelo: record.modelo ?? null,
      confianzaMin,
      confianzaMedia,
      campos,
      motivos: record.motivos ?? [],
    };
  }
}
