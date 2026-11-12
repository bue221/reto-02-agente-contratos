import type { Contrato } from "./types.ts";
import { diasEntre, formatoCOP } from "./parse.ts";

export interface FilaAlerta { contrato: Contrato; dias: number }
export interface Reporte {
  hoy: string;
  vencidos: FilaAlerta[];
  hasta30: FilaAlerta[];
  hasta60: FilaAlerta[];
  hasta90: FilaAlerta[];
  vigentes: number;
}

export function reporteVencimientos(contratos: Contrato[], hoy: string): Reporte {
  const r: Reporte = { hoy, vencidos: [], hasta30: [], hasta60: [], hasta90: [], vigentes: 0 };
  for (const c of contratos) {
    const dias = diasEntre(hoy, c.fecha_fin);
    const fila = { contrato: c, dias };
    if (dias < 0 || c.estado === "VENCIDO") r.vencidos.push(fila);
    else if (dias <= 30) r.hasta30.push(fila);
    else if (dias <= 60) r.hasta60.push(fila);
    else if (dias <= 90) r.hasta90.push(fila);
    else r.vigentes++;
  }
  const porDias = (a: FilaAlerta, b: FilaAlerta) => a.dias - b.dias;
  for (const k of ["vencidos", "hasta30", "hasta60", "hasta90"] as const) r[k].sort(porDias);
  return r;
}

export function formatearReporte(r: Reporte): string {
  const bloque = (titulo: string, filas: FilaAlerta[], vencido = false) => {
    if (!filas.length) return `**${titulo}:** ninguno`;
    const lineas = filas.map(({ contrato: c, dias }) =>
      `- ${c.id_contrato} ${c.cliente} — ${formatoCOP(c.valor)} — vence ${c.fecha_fin} (${vencido ? `hace ${Math.abs(dias)} d` : `en ${dias} d`}) — ${c.comercial_email}`);
    return `**${titulo}:**\n\n${lineas.join("\n")}`;
  };
  return [
    `**ALERTAS DE VENCIMIENTO** (referencia: ${r.hoy})`,
    bloque("🔴 Vencidos", r.vencidos, true),
    bloque("🟠 Vencen en ≤ 30 días", r.hasta30),
    bloque("🟡 Vencen en 31–60 días", r.hasta60),
    bloque("🟢 Vencen en 61–90 días", r.hasta90),
    `Vigentes con más de 90 días: ${r.vigentes}`,
  ].join("\n\n");
}
