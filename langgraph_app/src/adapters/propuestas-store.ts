/**
 * Propuestas en JSON (outDir/propuestas.json). Persiste entre reinicios de la API,
 * así una tarjeta pendiente no se pierde si el proceso cae.
 */
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import type { EstadoPropuesta, Propuesta } from "../domain/types.ts";
import type { PropuestasStore } from "../ports/propuestas.ts";

export class JsonPropuestasStore implements PropuestasStore {
  constructor(private readonly cfg: Config) {}

  private get ruta(): string {
    return path.join(this.cfg.outDir, "propuestas.json");
  }

  private leer(): Propuesta[] {
    if (!fs.existsSync(this.ruta)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.ruta, "utf8")) as { items?: Propuesta[] };
      return raw.items ?? [];
    } catch (e) {
      console.error(`[propuestas] archivo corrupto, se ignora: ${(e as Error).message}`);
      return [];
    }
  }

  private guardar(items: Propuesta[]): void {
    fs.mkdirSync(this.cfg.outDir, { recursive: true });
    // Escritura atómica: evita JSON a medias si el proceso muere escribiendo.
    const tmp = `${this.ruta}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2) + "\n");
    fs.renameSync(tmp, this.ruta);
  }

  get(msgId: string): Propuesta | null {
    const id = msgId.trim().toLowerCase();
    return this.leer().find((p) => p.msgId === id) ?? null;
  }

  list(estado?: EstadoPropuesta): Propuesta[] {
    const items = this.leer().sort((a, b) => a.msgId.localeCompare(b.msgId));
    return estado ? items.filter((p) => p.estado === estado) : items;
  }

  upsert(propuesta: Propuesta): void {
    const items = this.leer().filter((p) => p.msgId !== propuesta.msgId);
    items.push(propuesta);
    this.guardar(items);
  }
}
