import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CampoContrato, Contrato } from "../src/core/domain/contract.ts";
import { llamarHerramienta } from "../src/application/workflows/tool-call.ts";
import type { ContextoHerramienta } from "../src/tools/tool.ts";

export const RAIZ = join(import.meta.dir, "..", "..");
export const HOY = "2026-09-03";
/** Por demanda, firma sin día, moneda inferida de la cláusula de garantías y póliza condicional. */
export const REVISION_006: CampoContrato[] = ["valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza"];

/** Copia archivo por archivo (el fixture es de solo lectura y `cp` conservaría esos permisos). */
async function copiarCarpeta(origen: string, destino: string): Promise<void> {
  await mkdir(destino, { recursive: true });
  for (const entrada of await readdir(origen, { withFileTypes: true })) {
    const desde = join(origen, entrada.name);
    const hacia = join(destino, entrada.name);
    if (entrada.isDirectory()) await copiarCarpeta(desde, hacia);
    else await writeFile(hacia, await readFile(desde));
  }
}

/** Proyecto aislado en un directorio temporal: cada test tiene su propio `out/` y puede agregar mensajes. */
export async function crearProyecto(): Promise<ContextoHerramienta> {
  const directorio = await mkdtemp(join(tmpdir(), "contratos-"));
  await copiarCarpeta(join(RAIZ, "fixtures", "reto-02"), join(directorio, "fixtures", "reto-02"));
  return { directory: directorio, sessionId: "test", hoy: HOY };
}

export async function agregarMensaje(ctx: ContextoHerramienta, id: string, adjuntos: Record<string, string>): Promise<void> {
  const carpeta = join(ctx.directory, "fixtures", "reto-02", "buzon", id);
  await mkdir(carpeta, { recursive: true });
  const correo = { id, de: "lgomez@periferia-ficticia.com", para: "contratos@periferia-ficticia.com", asunto: `Prueba ${id}`, fecha: "2026-09-01T10:00:00-05:00", cuerpo: "", adjuntos: Object.keys(adjuntos) };
  await writeFile(join(carpeta, "correo.json"), JSON.stringify(correo));
  for (const [nombre, texto] of Object.entries(adjuntos)) await writeFile(join(carpeta, nombre), texto);
}

export const leerSalida = (ctx: ContextoHerramienta, ...ruta: string[]): Promise<string> =>
  readFile(join(ctx.directory, "out", ...ruta), "utf8").catch(() => "");

export const leerFixture = (...ruta: string[]): Promise<string> => readFile(join(RAIZ, "fixtures", "reto-02", ...ruta), "utf8");

export async function extraerOk(ctx: ContextoHerramienta, mensajeId: string): Promise<Contrato> {
  const resultado = await llamarHerramienta<Contrato>("contratos_extraer", { mensaje_id: mensajeId }, ctx);
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.data;
}

export const lineasJson = (texto: string): Record<string, unknown>[] =>
  texto
    .split("\n")
    .filter(Boolean)
    .map((linea) => JSON.parse(linea) as Record<string, unknown>);

/** Contrato de la prueba con la prosa de los fixtures; `cambios` reemplaza fragmentos para provocar errores. */
export async function contratoModificado(cambios: Record<string, string>): Promise<string> {
  let texto = await leerFixture("buzon", "msg-001", "contrato.txt");
  for (const [original, reemplazo] of Object.entries(cambios)) texto = texto.replace(original, reemplazo);
  return texto;
}
