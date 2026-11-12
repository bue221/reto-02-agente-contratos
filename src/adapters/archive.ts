import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import type { Correo } from "../types.ts";

/** Archiva los adjuntos del correo bajo output/<destino>/ y devuelve las rutas relativas. */
export function archivar(cfg: Config, correo: Correo, destino: string): string[] {
  const dir = path.join(cfg.outDir, destino);
  fs.mkdirSync(dir, { recursive: true });
  const rutas: string[] = [];
  for (const a of correo.adjuntos) {
    const nombre = `${correo.id}__${a.nombre}`;
    fs.writeFileSync(path.join(dir, nombre), a.texto);
    rutas.push(path.posix.join(destino, nombre));
  }
  const meta = `${correo.id}__correo.json`;
  fs.writeFileSync(
    path.join(dir, meta),
    JSON.stringify({ de: correo.de, fecha: correo.fecha, asunto: correo.asunto, cuerpo: correo.cuerpo }, null, 2),
  );
  rutas.push(path.posix.join(destino, meta));
  return rutas;
}

export function auditar(cfg: Config, registro: unknown) {
  fs.mkdirSync(cfg.outDir, { recursive: true });
  fs.appendFileSync(path.join(cfg.outDir, "auditoria.jsonl"), JSON.stringify(registro) + "\n");
}
