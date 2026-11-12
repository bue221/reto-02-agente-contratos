import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import type { Correo } from "../types.ts";

export function listarMensajes(cfg: Config): string[] {
  return fs
    .readdirSync(cfg.buzonDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^msg-\d+$/.test(d.name))
    .map((d) => d.name)
    .sort();
}

export function leerMensaje(cfg: Config, msgId: string): Correo {
  const dir = path.join(cfg.buzonDir, msgId);
  if (!fs.existsSync(dir)) throw new Error(`No existe el mensaje ${msgId} en el buzón`);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "correo.json"), "utf8"));
  const adjuntos = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((nombre) => ({ nombre, texto: fs.readFileSync(path.join(dir, nombre), "utf8") }));
  return { id: msgId, de: meta.de, fecha: meta.fecha, asunto: meta.asunto, cuerpo: meta.cuerpo, adjuntos };
}
