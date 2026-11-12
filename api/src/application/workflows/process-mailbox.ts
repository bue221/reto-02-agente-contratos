import type { Buzon } from "../use-cases/read-mailbox.ts";
import type { Registro } from "../use-cases/register.ts";
import type { ValidacionReportada } from "../use-cases/validate.ts";
import type { Contrato } from "../../core/domain/contract.ts";
import type { Resultado } from "../../core/domain/result.ts";
import { ejecutarHerramienta } from "../../tools/contratos.ts";
import type { ContextoHerramienta } from "../../tools/tool.ts";

/** Pasada determinista por el buzón usando solo las herramientas (sin modelo): la usan `demo.ts` y los tests. */

export interface ResultadoMensaje {
  mensaje_id: string;
  clasificacion: ValidacionReportada["clasificacion"] | null;
  requiere_revision: string[];
  accion: string;
  avisos: string[];
  contrato: Contrato | null;
}

/** Las herramientas devuelven JSON propio con forma `Resultado<T>`; el tipo lo fija quien llama. */
export async function llamarHerramienta<T>(nombre: string, args: unknown, ctx: ContextoHerramienta): Promise<Resultado<T>> {
  return JSON.parse(await ejecutarHerramienta(nombre, args, ctx)) as Resultado<T>;
}

const describirRegistro = (registro: Registro): string =>
  registro.accion === "duplicado" ? `sin escritura (duplicado de ${registro.id_contrato})` : `${registro.accion} ${registro.id_contrato} → ${registro.ruta_archivo}`;

async function accionTrasValidar(mensajeId: string, contrato: Contrato, validacion: ValidacionReportada, ctx: ContextoHerramienta): Promise<string> {
  if (validacion.clasificacion === "rechazado") return `rechazado: ${validacion.motivo}`;
  if (validacion.clasificacion === "duplicado") return `sin escritura: ${validacion.motivo}`;
  const registro = await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: mensajeId, contrato }, ctx);
  return registro.ok ? describirRegistro(registro.data) : `sin registrar: ${registro.error}`;
}

const conError = (mensajeId: string, error: string, contrato: Contrato | null = null): ResultadoMensaje => ({
  mensaje_id: mensajeId,
  clasificacion: null,
  requiere_revision: [],
  accion: `error: ${error}`,
  avisos: [],
  contrato,
});

/** extraer → validar → registrar (sin confirmar). Un error se reporta en el resultado y nunca corta el lote. */
export async function procesarMensaje(mensajeId: string, ctx: ContextoHerramienta): Promise<ResultadoMensaje> {
  const extraido = await llamarHerramienta<Contrato>("contratos_extraer", { mensaje_id: mensajeId }, ctx);
  if (!extraido.ok) return conError(mensajeId, extraido.error);
  const validacion = await llamarHerramienta<ValidacionReportada>("contratos_validar", { mensaje_id: mensajeId, contrato: extraido.data }, ctx);
  if (!validacion.ok) return conError(mensajeId, validacion.error, extraido.data);
  return {
    mensaje_id: mensajeId,
    clasificacion: validacion.data.clasificacion,
    requiere_revision: validacion.data.requiere_revision,
    accion: await accionTrasValidar(mensajeId, extraido.data, validacion.data, ctx),
    avisos: validacion.data.avisos,
    contrato: extraido.data,
  };
}

export async function procesarBuzon(ctx: ContextoHerramienta): Promise<Resultado<ResultadoMensaje[]>> {
  const buzon = await llamarHerramienta<Buzon>("contratos_leer_buzon", {}, ctx);
  if (!buzon.ok) return buzon;
  const resultados: ResultadoMensaje[] = [];
  for (const mensaje of buzon.data.mensajes) resultados.push(await procesarMensaje(mensaje.id, ctx));
  for (const { id, error } of buzon.data.errores) resultados.push(conError(id, error));
  return { ok: true, data: resultados };
}
