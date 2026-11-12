import { relative } from "node:path";
import { escribirTexto } from "../../infrastructure/files.ts";
import { leerMaestro } from "../../infrastructure/master-store.ts";
import type { Rutas } from "../../infrastructure/paths.ts";
import { diasEntre } from "../../core/domain/dates.ts";
import type { FilaMaestro } from "../../core/domain/master.ts";
import { DIAS_ALERTA_VENCIMIENTO, FECHA_CORTE_MAESTRO } from "../../core/domain/parameters.ts";
import { type Resultado, exito } from "../../core/domain/result.ts";

export interface Vencimiento {
  id_contrato: string;
  cliente: string;
  fecha_fin: string;
  dias_restantes: number;
}

export interface PolizaPendiente {
  id_contrato: string;
  cliente: string;
  tipo_poliza: string;
  estado_poliza: string;
}

export interface RegistroReciente {
  id_contrato: string;
  cliente: string;
  fecha_registro: string;
  fuente: string;
}

export interface Alertas {
  ruta: string;
  vencen: Vencimiento[];
  polizas_pendientes: PolizaPendiente[];
  registrados_desde_corte: RegistroReciente[];
}

const vencimientos = (maestro: readonly FilaMaestro[], hoy: string): Vencimiento[] =>
  maestro
    .map((fila) => ({ id_contrato: fila.id_contrato, cliente: fila.cliente, fecha_fin: fila.fecha_fin, dias_restantes: diasEntre(hoy, fila.fecha_fin) }))
    .filter((vencimiento) => vencimiento.dias_restantes >= 0 && vencimiento.dias_restantes <= DIAS_ALERTA_VENCIMIENTO)
    .sort((a, b) => a.dias_restantes - b.dias_restantes);

const polizasPendientes = (maestro: readonly FilaMaestro[]): PolizaPendiente[] =>
  maestro
    .filter((fila) => fila.requiere_poliza && fila.estado_poliza !== "vigente")
    .map(({ id_contrato, cliente, tipo_poliza, estado_poliza }) => ({ id_contrato, cliente, tipo_poliza, estado_poliza }));

const registradosDesdeCorte = (maestro: readonly FilaMaestro[]): RegistroReciente[] =>
  maestro
    .filter((fila) => fila.fecha_registro >= FECHA_CORTE_MAESTRO)
    .map(({ id_contrato, cliente, fecha_registro, fuente }) => ({ id_contrato, cliente, fecha_registro, fuente }));

const tabla = (encabezados: string[], filas: (string | number)[][]): string =>
  filas.length === 0
    ? "_Sin registros._"
    : [`| ${encabezados.join(" | ")} |`, `|${encabezados.map(() => "---").join("|")}|`, ...filas.map((fila) => `| ${fila.join(" | ")} |`)].join("\n");

function renderizar(alertas: Omit<Alertas, "ruta">, hoy: string): string {
  return [
    `# Alertas de contratos — ${hoy}`,
    "",
    `## Vencen en ≤ ${DIAS_ALERTA_VENCIMIENTO} días`,
    "",
    tabla(["Contrato", "Cliente", "Fecha fin", "Días restantes"], alertas.vencen.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, v.dias_restantes])),
    "",
    "## Pólizas requeridas no vigentes",
    "",
    tabla(["Contrato", "Cliente", "Tipo de póliza", "Estado"], alertas.polizas_pendientes.map((p) => [p.id_contrato, p.cliente, p.tipo_poliza || "—", p.estado_poliza])),
    "",
    `## Registrados desde el ${FECHA_CORTE_MAESTRO} (gap cubierto)`,
    "",
    tabla(["Contrato", "Cliente", "Fecha registro", "Fuente"], alertas.registrados_desde_corte.map((r) => [r.id_contrato, r.cliente, r.fecha_registro, r.fuente])),
    "",
  ].join("\n");
}

/** HU-5: `hoy` llega como argumento para que el reporte sea determinista. */
export async function generarAlertas(rutas: Rutas, hoy: string, directorio: string): Promise<Resultado<Alertas>> {
  const maestro = await leerMaestro(rutas);
  const contenido = { vencen: vencimientos(maestro, hoy), polizas_pendientes: polizasPendientes(maestro), registrados_desde_corte: registradosDesdeCorte(maestro) };
  await escribirTexto(rutas.alertas, renderizar(contenido, hoy));
  return exito({ ruta: relative(directorio, rutas.alertas), ...contenido });
}
