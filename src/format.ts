import type { Ctx } from "./types.ts";
import { formatoCOP } from "./util.ts";

const ETIQUETA: Record<string, string> = {
  REGISTRAR_NUEVO: "✅ REGISTRADO COMO NUEVO",
  ACTUALIZAR: "🔄 ACTUALIZADO",
  DUPLICADO: "♻️  DUPLICADO (sin cambios)",
  RECHAZAR: "⛔ RECHAZADO",
  REVISION_HUMANA: "👀 REQUIERE REVISIÓN HUMANA",
};

export function formatearResultado(ctx: Ctx): string {
  const L: string[] = [];
  L.push(`${ctx.msgId} → ${ETIQUETA[ctx.decision ?? "RECHAZAR"]}${ctx.contratoId ? ` [${ctx.contratoId}]` : ""}`);
  if (ctx.clasificacion) L.push(`  Tipo: ${ctx.clasificacion.tipo} (confianza ${ctx.clasificacion.confianza.toFixed(2)})`);
  if (ctx.autor) L.push(`  Comercial: ${ctx.autor.nombre} · ${ctx.autor.region}`);

  const ex = ctx.extraccion;
  if (ex) {
    L.push("  Datos extraídos (valor · confianza):");
    const fila = (n: string, c: { valor: unknown; confianza: number }, f: (v: any) => string = String) => {
      if (c.valor !== null) L.push(`    - ${n}: ${f(c.valor)} · ${c.confianza.toFixed(2)}`);
    };
    fila("id contrato", ex.idContrato); fila("cliente", ex.cliente); fila("NIT", ex.nit);
    fila("valor", ex.valor, formatoCOP); fila("inicio", ex.fechaInicio); fila("fin", ex.fechaFin);
  }
  L.push("  Motivos:");
  for (const m of ctx.motivos) L.push(`    - ${m}`);
  for (const [k, c] of Object.entries(ctx.cambios)) L.push(`  Cambio ${k}: ${c.antes} → ${c.despues}`);
  return L.join("\n");
}
