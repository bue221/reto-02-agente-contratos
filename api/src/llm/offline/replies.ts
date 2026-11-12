import type { Alertas } from "../../application/use-cases/alerts.ts";
import type { ExplicacionMensaje } from "../../application/use-cases/mailbox-view.ts";
import type { ConsultaMaestro } from "../../application/use-cases/master-query.ts";
import type { RespuestaBuzon } from "../../http/types.ts";
import type { DecisionReportada, PasadaReportada } from "../../tools/recepcion.ts";

/** Redacción de las respuestas del guion offline: todo valor citado sale de un resultado de herramienta (CA2). */

type MensajeReportado = PasadaReportada["mensajes"][number];

const accionDe = (mensaje: MensajeReportado): string => (mensaje.desenlace === "en_revision" ? "**pendiente de tu confirmación**" : mensaje.accion);

export function tablaDePasada(mensajes: readonly MensajeReportado[]): string {
  const filas = mensajes.map(
    (mensaje) => `| ${mensaje.mensaje_id} | ${mensaje.clasificacion ?? "error"} | ${mensaje.requiere_revision.join(", ") || "—"} | ${accionDe(mensaje)} |`,
  );
  return ["| Mensaje | Clasificación | Requiere revisión | Acción |", "|---|---|---|---|", ...filas].join("\n");
}

export function detalleDeRevision(mensaje: MensajeReportado): string {
  const campos = mensaje.revision.map(({ campo, valor, confianza, evidencia, motivo }) => {
    const cita = evidencia ? ` — evidencia: "${evidencia}"` : "";
    // El motivo de baja confianza ya cita la confianza; los conflictos con el maestro no.
    const porque = motivo.startsWith("confianza") ? motivo : `confianza ${confianza}; ${motivo}`;
    return `- **${campo}**: ${JSON.stringify(valor)} (${porque})${cita}`;
  });
  const avisos = mensaje.avisos.map((aviso) => `- aviso: ${aviso}`);
  return [`### ${mensaje.mensaje_id} (${mensaje.id_contrato ?? "sin número"}) requiere revisión`, ...campos, ...avisos].join("\n");
}

const listar = (elementos: readonly string[], vacio: string): string => elementos.join(", ") || vacio;

export function resumenDeAlertas(alertas: Alertas | { error: string } | null): string {
  if (!alertas) return "";
  if ("error" in alertas) return `### Alertas\nNo pude generar el reporte: ${alertas.error}`;
  const { ruta, vencen, polizas_pendientes, registrados_desde_corte } = alertas;
  return [
    `### Alertas (${ruta})`,
    `- Vencen en ≤ 60 días: ${listar(vencen.map((v) => `${v.id_contrato} (${v.dias_restantes} d)`), "ninguno")}`,
    `- Pólizas requeridas no vigentes: ${listar(polizas_pendientes.map((p) => `${p.id_contrato} (${p.estado_poliza})`), "ninguna")}`,
    `- Registrados desde el corte: ${listar(registrados_desde_corte.map((r) => r.id_contrato), "ninguno")}`,
  ].join("\n");
}

export function preguntaDeConfirmacion(ids: readonly string[]): string {
  return `Responde «confirmo …» (por ejemplo, «confirmo el valor 0 y la fecha fin 2027-08-31»), indícame la corrección o «rechaza ${ids[0] ?? "msg-…"} porque …». ¿Confirmas los campos en revisión de ${ids.join(", ")}?`;
}

export function cierreDePasada(pasada: PasadaReportada): string {
  const { mensajes, omitidos, en_revision, alertas } = pasada;
  if (mensajes.length === 0 && omitidos.length === 0) return ["El buzón no tiene mensajes pendientes.", resumenDeAlertas(alertas)].join("\n\n");
  const partes = [
    mensajes.length > 0 ? `El motor procesó ${mensajes.length} mensajes:` : "",
    mensajes.length > 0 ? tablaDePasada(mensajes) : "",
    ...omitidos.map((omitido) => `- ${omitido.mensaje_id}: ${omitido.motivo}`),
    ...mensajes.filter((mensaje) => mensaje.desenlace === "en_revision").map(detalleDeRevision),
    resumenDeAlertas(alertas),
  ];
  if (en_revision.length > 0) partes.push(`No registré nada dudoso. ${preguntaDeConfirmacion(en_revision)}`);
  return partes.filter(Boolean).join("\n\n");
}

export function describirDecision(decision: DecisionReportada): string {
  if (decision.decision === "rechazado") return `- ${decision.mensaje_id}: rechazado, sin escritura en el maestro`;
  return `- ${decision.mensaje_id}: ${decision.accion ?? "sin escritura"} ${decision.id_contrato ?? ""}`.trimEnd();
}

export function tablaDeEstado(buzon: RespuestaBuzon): string {
  const { total, pendientes, requiere_revision, procesados } = buzon.contadores;
  const filas = buzon.mensajes.map((mensaje) => `| ${mensaje.id} | ${mensaje.estado} | ${mensaje.clasificacion ?? "—"} | ${mensaje.id_contrato ?? "—"} |`);
  return [
    `Buzón: ${total} mensajes, ${pendientes} pendientes, ${requiere_revision} en revisión, ${procesados} procesados.`,
    ["| Mensaje | Estado | Clasificación | Contrato |", "|---|---|---|---|", ...filas].join("\n"),
  ].join("\n\n");
}

export function tablaDeMaestro(consulta: ConsultaMaestro): string {
  if (consulta.total === 0) return "No encontré contratos en el maestro con esa búsqueda.";
  const filas = consulta.filas.map((fila) => `| ${fila.id_contrato} | ${fila.cliente} | ${fila.fecha_fin} | ${fila.valor} ${fila.moneda} | ${fila.estado_poliza} |`);
  const truncado = consulta.truncado ? `\n\nSe muestran ${consulta.filas.length} de ${consulta.total}: afina la búsqueda.` : "";
  return `${["| Contrato | Cliente | Fecha fin | Valor | Póliza |", "|---|---|---|---|---|", ...filas].join("\n")}${truncado}`;
}

export function explicacion(detalle: ExplicacionMensaje): string {
  const { mensaje, validacion, extraccion, decision } = detalle;
  if (!validacion || !extraccion) return `${mensaje.id} está **${mensaje.estado}**: aún no lo ha analizado el motor. Pídeme que lo procese.`;
  const revisiones = validacion.revisiones.map(({ campo, motivo }) => `- **${campo}**: ${JSON.stringify(extraccion[campo].valor)} — ${motivo}`);
  const decidido = decision ? `Decisión: ${decision.decision} por ${decision.aprobador} (${decision.via}).` : "";
  return [
    `${mensaje.id} está **${mensaje.estado}**; clasificación **${validacion.clasificacion}**${validacion.motivo ? ` (${validacion.motivo})` : ""}.`,
    revisiones.length > 0 ? `Campos en revisión:\n${revisiones.join("\n")}` : "Sin campos en revisión.",
    ...validacion.avisos.map((aviso) => `- aviso: ${aviso}`),
    decidido,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const AYUDA_OFFLINE = [
  "Estoy en **modo sin modelo** (proveedor offline): sigo un guion determinista sobre las mismas herramientas de la recepcionista.",
  "Puedo: «procesa el buzón con fecha de hoy 2026-09-03», «¿cuál es el estado del buzón?», «explica msg-006», «busca CT-2026-009 en el maestro», «genera las alertas al 2026-09-03» y, cuando pida confirmación, «confirmo el valor 0 y la fecha fin 2027-08-31» o «rechaza msg-006 porque falta la firma».",
  "Para conversación libre configura `GOOGLE_API_KEY` en el backend.",
].join("\n\n");
