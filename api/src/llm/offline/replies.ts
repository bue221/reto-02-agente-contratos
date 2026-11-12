import type { Alertas } from "../../application/use-cases/alerts.ts";
import type { Registro } from "../../application/use-cases/register.ts";
import type { ValidacionReportada } from "../../application/use-cases/validate.ts";
import type { Contrato } from "../../core/domain/contract.ts";
import type { Resultado } from "../../core/domain/result.ts";
import { type Ejecucion, buscar, esPendienteDeRevision } from "./history.ts";

/** Redacción de las respuestas del guion offline: todo valor citado sale de un resultado de herramienta (CA2). */

const EXTRAER = "contratos_extraer";
const VALIDAR = "contratos_validar";
const REGISTRAR = "contratos_registrar";

function accionDe(validacion: Resultado<ValidacionReportada> | undefined, registro: Resultado<Registro> | undefined): string {
  if (registro?.ok) return `${registro.data.accion} ${registro.data.id_contrato ?? ""}`.trim();
  if (registro && esPendienteDeRevision(registro)) return "**pendiente de tu confirmación**";
  if (registro && !registro.ok) return `sin registrar: ${registro.error}`;
  if (!validacion?.ok) return `error: ${validacion?.ok === false ? validacion.error : "sin validar"}`;
  return `sin escritura: ${validacion.data.motivo ?? validacion.data.clasificacion}`;
}

function filaDeTabla(turno: readonly Ejecucion[], id: string): string {
  const extraido = buscar<Contrato>(turno, EXTRAER, id);
  const validacion = buscar<ValidacionReportada>(turno, VALIDAR, id);
  const registro = buscar<Registro>(turno, REGISTRAR, id);
  const clasificacion = validacion?.ok ? validacion.data.clasificacion : extraido?.ok === false ? `error: ${extraido.error}` : "—";
  const revision = validacion?.ok ? validacion.data.requiere_revision.join(", ") || "—" : "—";
  return `| ${id} | ${clasificacion} | ${revision} | ${accionDe(validacion, registro)} |`;
}

export function tablaDeMensajes(turno: readonly Ejecucion[], ids: readonly string[]): string {
  return ["| Mensaje | Clasificación | Requiere revisión | Acción |", "|---|---|---|---|", ...ids.map((id) => filaDeTabla(turno, id))].join("\n");
}

function lineaDeCampo(contrato: Contrato, campo: ValidacionReportada["requiere_revision"][number]): string {
  const { valor, confianza, evidencia } = contrato[campo];
  const cita = evidencia ? ` — evidencia: "${evidencia}"` : "";
  return `- **${campo}**: ${JSON.stringify(valor)} (confianza ${confianza})${cita}`;
}

export function detalleDeRevision(turno: readonly Ejecucion[], id: string): string {
  const extraido = buscar<Contrato>(turno, EXTRAER, id);
  const validacion = buscar<ValidacionReportada>(turno, VALIDAR, id);
  if (!extraido?.ok || !validacion?.ok) return `### ${id}\nNo tengo la extracción de este mensaje.`;
  const campos = validacion.data.requiere_revision.map((campo) => lineaDeCampo(extraido.data, campo));
  const avisos = validacion.data.avisos.map((aviso) => `- aviso: ${aviso}`);
  return [`### ${id} (${extraido.data.id_contrato.valor ?? "sin número"}) requiere revisión`, ...campos, ...avisos].join("\n");
}

const listar = (elementos: readonly string[], vacio: string): string => elementos.join(", ") || vacio;

export function resumenDeAlertas(alertas: Resultado<Alertas> | undefined): string {
  if (!alertas) return "";
  if (!alertas.ok) return `### Alertas\nNo pude generar el reporte: ${alertas.error}`;
  const { ruta, vencen, polizas_pendientes, registrados_desde_corte } = alertas.data;
  return [
    `### Alertas (${ruta})`,
    `- Vencen en ≤ 60 días: ${listar(vencen.map((v) => `${v.id_contrato} (${v.dias_restantes} d)`), "ninguno")}`,
    `- Pólizas requeridas no vigentes: ${listar(polizas_pendientes.map((p) => `${p.id_contrato} (${p.estado_poliza})`), "ninguna")}`,
    `- Registrados desde el corte: ${listar(registrados_desde_corte.map((r) => r.id_contrato), "ninguno")}`,
  ].join("\n");
}

export function preguntaDeConfirmacion(ids: readonly string[]): string {
  return `Responde «confirmo …» (por ejemplo, «confirmo el valor 0 y la fecha fin 2027-08-31») o indícame la corrección. ¿Confirmas los campos en revisión de ${ids.join(", ")}?`;
}

export const AYUDA_OFFLINE = [
  "Estoy en **modo sin modelo** (proveedor offline): sigo un guion determinista sobre las mismas herramientas.",
  "Puedo: «procesa el buzón con fecha de hoy 2026-09-03», «genera las alertas al 2026-09-03» y, cuando pida confirmación, «confirmo el valor 0 y la fecha fin 2027-08-31».",
  "Para conversación libre configura `GOOGLE_API_KEY` en el backend.",
].join("\n\n");
