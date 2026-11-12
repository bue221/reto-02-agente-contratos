import type { Contrato } from "../dominio/contrato.ts";
import { COLUMNAS_MAESTRO, type EstadoPoliza, type FilaMaestro, FilaMaestroSchema } from "../dominio/maestro.ts";
import { type Resultado, exito, fallo } from "../dominio/resultado.ts";
import { slugCliente } from "../dominio/texto.ts";
import type { CamposEfectivos } from "./campos.ts";

export interface OpcionesFila {
  contrato: Contrato;
  existente: FilaMaestro | null;
  maestro: readonly FilaMaestro[];
  comercial: string;
  fechaRegistro: string;
  extension: string;
}

export interface FilaConstruida {
  fila: FilaMaestro;
  /** Ruta relativa a `out/sharepoint/` donde se copia este documento. */
  rutaArchivo: string;
}

export type Cambios = Record<string, { antes: string | number | boolean | null; despues: string | number | boolean }>;

/** "Si no existe, AUTO-<año>-<secuencia>" (PRD 7.2). */
function siguienteIdAuto(maestro: readonly FilaMaestro[], anio: string): string {
  const prefijo = `AUTO-${anio}-`;
  const usados = maestro.filter((fila) => fila.id_contrato.startsWith(prefijo)).length;
  return `${prefijo}${String(usados + 1).padStart(3, "0")}`;
}

/**
 * Nuevo con póliza → pendiente (PRD 7.2). Un otrosí que amplía el plazo de un contrato con póliza la deja
 * pendiente: la póliza vigente no cubre el nuevo plazo hasta que la aseguradora la amplíe.
 */
function estadoPoliza(requiere: boolean, existente: FilaMaestro | null, ampliaPlazo: boolean): EstadoPoliza {
  if (!requiere) return "no_aplica";
  if (!existente || !existente.requiere_poliza || ampliaPlazo) return "pendiente";
  return existente.estado_poliza;
}

function rutaDeArchivo(fila: FilaMaestro, contrato: Contrato, extension: string): string {
  const sufijo = contrato.tipo_documento === "otrosi" ? `-otrosi-${contrato.numero_otrosi ?? 1}` : "";
  return `Contratos/${fila.fecha_inicio.slice(0, 4)}/${slugCliente(fila.cliente)}/${fila.id_contrato}${sufijo}${extension}`;
}

const describirErrores = (issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string =>
  issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");

export function construirFila(campos: CamposEfectivos, opciones: OpcionesFila): Resultado<FilaConstruida> {
  const { contrato, existente } = opciones;
  const fechaInicio = campos.fecha_inicio.valor;
  const requiere = campos.requiere_poliza.valor === true;
  const ampliaPlazo = existente !== null && typeof campos.fecha_fin.valor === "string" && campos.fecha_fin.valor > existente.fecha_fin;
  const candidata = {
    ...Object.fromEntries(Object.entries(campos).map(([campo, efectivo]) => [campo, efectivo.valor])),
    id_contrato: campos.id_contrato.valor ?? siguienteIdAuto(opciones.maestro, String(fechaInicio ?? "").slice(0, 4)),
    tipo_poliza: requiere ? campos.tipo_poliza.valor : "",
    estado_poliza: estadoPoliza(requiere, existente, ampliaPlazo),
    comercial: existente?.comercial || opciones.comercial,
    ruta_sharepoint: existente?.ruta_sharepoint ?? "",
    fecha_registro: existente?.fecha_registro ?? opciones.fechaRegistro,
    fuente: existente?.fuente ?? "buzon",
  };
  const validada = FilaMaestroSchema.safeParse(candidata);
  if (!validada.success) return fallo(`datos incompletos o inválidos para registrar: ${describirErrores(validada.error.issues)}`);
  const rutaArchivo = rutaDeArchivo(validada.data, contrato, opciones.extension);
  const conservaRuta = contrato.tipo_documento === "otrosi" && existente !== null;
  return exito({ fila: { ...validada.data, ruta_sharepoint: conservaRuta ? validada.data.ruta_sharepoint : rutaArchivo }, rutaArchivo });
}

export function cambiosEntre(antes: FilaMaestro | null, despues: FilaMaestro): Cambios {
  const cambiadas = COLUMNAS_MAESTRO.filter((columna) => antes?.[columna] !== despues[columna]);
  return Object.fromEntries(cambiadas.map((columna) => [columna, { antes: antes?.[columna] ?? null, despues: despues[columna] }]));
}
