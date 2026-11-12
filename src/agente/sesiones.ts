import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SesionPublica } from "../api/tipos.ts";
import { mensajeDeError } from "../dominio/resultado.ts";
import type { MensajeLlm } from "../llm/adapter.ts";

/** Sesión completa: lo visible para el chat más el historial que se reenvía al modelo. */
export interface Sesion extends SesionPublica {
  mensajes: MensajeLlm[];
}

export interface AlmacenSesiones {
  obtener(id: string): Promise<Sesion | null>;
  guardar(sesion: Sesion): Promise<void>;
  /** Reinicio de la demo: olvida las sesiones en memoria (los archivos los borra quien vacía `out/`). */
  vaciar(): void;
}

export const ID_SESION = /^[A-Za-z0-9_-]{1,64}$/;

export function nuevaSesion(id: string): Sesion {
  const ahora = new Date().toISOString();
  return { id, creada: ahora, actualizada: ahora, tokens: { entrada: 0, salida: 0 }, pendientesConfirmacion: [], turnos: [], mensajes: [] };
}

/** Memoria como fuente principal y `out/sesiones/<id>.json` como respaldo: si el disco falla, la sesión sigue viva. */
export class SesionesEnArchivo implements AlmacenSesiones {
  readonly #memoria = new Map<string, Sesion>();
  readonly #carpeta: string;

  constructor(directorio: string) {
    this.#carpeta = join(directorio, "out", "sesiones");
  }

  async obtener(id: string): Promise<Sesion | null> {
    if (!ID_SESION.test(id)) return null;
    const enMemoria = this.#memoria.get(id);
    if (enMemoria) return enMemoria;
    const delDisco = await this.#leer(id);
    if (delDisco) this.#memoria.set(id, delDisco);
    return delDisco;
  }

  async guardar(sesion: Sesion): Promise<void> {
    this.#memoria.set(sesion.id, sesion);
    try {
      await mkdir(this.#carpeta, { recursive: true });
      await writeFile(join(this.#carpeta, `${sesion.id}.json`), JSON.stringify(sesion, null, 2));
    } catch (error) {
      console.error(`[sesiones] no se pudo persistir ${sesion.id}: ${mensajeDeError(error)}`);
    }
  }

  vaciar(): void {
    this.#memoria.clear();
  }

  async #leer(id: string): Promise<Sesion | null> {
    try {
      // Archivo escrito por este mismo almacén.
      return JSON.parse(await readFile(join(this.#carpeta, `${id}.json`), "utf8")) as Sesion;
    } catch {
      return null;
    }
  }
}

/** Serializa los turnos de una misma sesión: dos peticiones simultáneas no pueden intercalar su historial. */
export class CerrojoPorSesion {
  readonly #colas = new Map<string, Promise<void>>();

  ejecutar<T>(id: string, tarea: () => Promise<T>): Promise<T> {
    const actual = (this.#colas.get(id) ?? Promise.resolve()).then(tarea);
    const cola = actual.then(
      () => undefined,
      () => undefined,
    );
    this.#colas.set(id, cola);
    void cola.then(() => {
      if (this.#colas.get(id) === cola) this.#colas.delete(id);
    });
    return actual;
  }
}
