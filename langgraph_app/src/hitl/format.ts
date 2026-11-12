import { getCfg } from "../deps.ts";
import type { Decision, Propuesta } from "../domain/types.ts";
import { formatoCOP } from "../parse.ts";

export const ETIQUETA_DECISION: Record<Decision, string> = {
  REGISTRAR_NUEVO: "Registrar como contrato nuevo",
  ACTUALIZAR: "Actualizar contrato existente",
  DUPLICADO: "Marcar como duplicado (sin cambios)",
  RECHAZAR: "Rechazar (no es procesable)",
  REVISION_HUMANA: "Requiere que confirmes o corrijas datos",
};

const CAMPOS: [keyof NonNullable<Propuesta["extraccion"]>, string][] = [
  ["idContrato", "id contrato"],
  ["cliente", "cliente"],
  ["nit", "NIT"],
  ["valor", "valor"],
  ["fechaInicio", "inicio"],
  ["fechaFin", "fin"],
];

/**
 * Tarjeta en markdown para chat/CLI (el chat web la renderiza; en terminal se lee igual).
 * El frontend usa el JSON para las tarjetas interactivas.
 */
export function formatearPropuesta(p: Propuesta): string {
  const umbral = getCfg().umbralConfianza;
  const lineas = [
    `**${p.msgId}** · Recomendación: **${ETIQUETA_DECISION[p.recomendacion]}** (\`${p.recomendacion}\`)`,
    "",
    `- Estado: ${p.estado}${p.estado === "PENDIENTE" ? " — esperando tu aprobación" : ""}`,
    `- Tipo: ${p.clasificacion.tipo} (${p.clasificacion.confianza.toFixed(2)}) · motor ${p.motor}`,
    `- Correo: ${p.correo.de} · "${p.correo.asunto}"`,
  ];

  if (p.extraccion) {
    lineas.push("- Datos (valor · confianza):");
    for (const [k, label] of CAMPOS) {
      const campo = p.extraccion[k];
      if (campo.valor === null) continue;
      const valor = k === "valor" ? formatoCOP(campo.valor as number) : String(campo.valor);
      const aviso = campo.confianza < umbral ? " · **confianza baja**" : "";
      lineas.push(`  - ${label}: ${valor} · ${campo.confianza.toFixed(2)}${aviso}`);
    }
  }

  if (p.motivos.length) {
    lineas.push("- Motivos:");
    for (const m of p.motivos) lineas.push(`  - ${m}`);
  }

  if (p.resolucion) {
    const r = p.resolucion;
    lineas.push(
      `- Resuelta por ${r.aprobador}: ${r.accion} → ${r.decisionFinal}${r.contratoId ? ` [${r.contratoId}]` : ""}`,
    );
    if (r.comentario) lineas.push(`- Comentario: ${r.comentario}`);
  } else {
    lineas.push("", "Siguiente paso: apruébala o recházala en la tarjeta de la bandeja. El agente no ejecuta.");
  }

  return lineas.join("\n");
}
