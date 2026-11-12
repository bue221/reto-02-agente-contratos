/**
 * Adapter fixtures: lee buzón estático + tracking de procesados en outDir.
 * Swap futuro: misma MailboxPort con IMAP/Graph.
 */
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import type { MailboxPort, MailboxStats } from "../ports/mailbox.ts";
import type { Correo } from "../types.ts";
import { leerMensaje, listarMensajes } from "./mailbox.ts";

function procesadosPath(cfg: Config): string {
  return path.join(cfg.outDir, "procesados.json");
}

function leerSet(cfg: Config): Set<string> {
  const p = procesadosPath(cfg);
  if (!fs.existsSync(p)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { ids?: string[] };
    return new Set((raw.ids ?? []).map((id) => String(id).toLowerCase()));
  } catch {
    return new Set();
  }
}

function guardarSet(cfg: Config, set: Set<string>): void {
  fs.mkdirSync(cfg.outDir, { recursive: true });
  fs.writeFileSync(
    procesadosPath(cfg),
    JSON.stringify({ ids: [...set].sort() }, null, 2) + "\n",
  );
}

export class FixturesMailbox implements MailboxPort {
  constructor(private readonly cfg: Config) {}

  listIds(): string[] {
    return listarMensajes(this.cfg);
  }

  getMessage(id: string): Correo {
    return leerMensaje(this.cfg, id);
  }

  markProcessed(id: string): void {
    const set = leerSet(this.cfg);
    set.add(String(id).trim().toLowerCase());
    guardarSet(this.cfg, set);
  }

  listProcessed(): string[] {
    const all = new Set(this.listIds().map((id) => id.toLowerCase()));
    return [...leerSet(this.cfg)].filter((id) => all.has(id)).sort();
  }

  listPending(): string[] {
    const done = leerSet(this.cfg);
    return this.listIds().filter((id) => !done.has(id.toLowerCase()));
  }

  stats(): MailboxStats {
    const total = this.listIds().length;
    const pendientes = this.listPending().length;
    return { total, pendientes, procesados: total - pendientes };
  }

  resetProcessed(): void {
    const p = procesadosPath(this.cfg);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
