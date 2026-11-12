import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import type { Contrato } from "../types.ts";
import { parseCsv, toCsv } from "../util.ts";

const COLUMNAS = [
  "id_contrato", "cliente", "nit", "valor", "moneda", "fecha_inicio",
  "fecha_fin", "comercial_email", "estado", "archivo", "actualizado_en",
] as const;

/**
 * Simula la lista de contratos de SharePoint con un CSV.
 * Nunca toca el archivo original de fixtures: trabaja sobre una copia en output/.
 * Para producción se reemplazaría por una implementación con Microsoft Graph manteniendo esta interfaz.
 */
export class MasterRepository {
  private readonly ruta: string;
  private readonly cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.ruta = path.join(cfg.outDir, "maestro-contratos.csv");
    this.init();
  }

  private init() {
    if (!fs.existsSync(this.ruta)) {
      fs.mkdirSync(this.cfg.outDir, { recursive: true });
      fs.copyFileSync(this.cfg.masterSeed, this.ruta);
    }
  }

  reset() {
    fs.rmSync(this.cfg.outDir, { recursive: true, force: true });
    this.init();
  }

  all(): Contrato[] {
    const [cabecera, ...filas] = parseCsv(fs.readFileSync(this.ruta, "utf8"));
    return filas.map((f) => {
      const o = Object.fromEntries(cabecera.map((c, i) => [c, f[i] ?? ""]));
      return { ...o, valor: Number(o.valor) } as unknown as Contrato;
    });
  }

  private save(contratos: Contrato[]) {
    const filas = [
      [...COLUMNAS] as string[],
      ...contratos.map((c) => COLUMNAS.map((k) => String(c[k]))),
    ];
    fs.writeFileSync(this.ruta, toCsv(filas));
  }

  findById(id: string) {
    return this.all().find((c) => c.id_contrato.toLowerCase() === id.toLowerCase());
  }

  findByNit(nit: string) {
    return this.all().filter((c) => c.nit === nit);
  }

  nextId(): string {
    const max = this.all().reduce((m, c) => Math.max(m, Number(c.id_contrato.replace(/\D/g, ""))), 0);
    return `C-${String(max + 1).padStart(3, "0")}`;
  }

  insert(c: Contrato) {
    this.save([...this.all(), c]);
  }

  update(id: string, patch: Partial<Contrato>) {
    const todos = this.all();
    const i = todos.findIndex((c) => c.id_contrato === id);
    if (i < 0) throw new Error(`Contrato ${id} no existe en el maestro`);
    todos[i] = { ...todos[i], ...patch };
    this.save(todos);
  }
}
