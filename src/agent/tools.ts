import type { Deps } from "../pipeline/index.ts";
import { procesarMensaje } from "../pipeline/index.ts";
import { listarMensajes } from "../adapters/mailbox.ts";
import { formatearResultado } from "../format.ts";
import { formatearReporte, reporteVencimientos } from "../report.ts";
import { formatoCOP } from "../util.ts";

export interface Herramienta {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(input: any): Promise<string>;
}

/** Las herramientas envuelven el pipeline determinista: el agente conversa, el código ejecuta. */
export function crearHerramientas(deps: Deps): Herramienta[] {
  return [
    {
      name: "listar_mensajes",
      description: "Lista los ids de los mensajes disponibles en el buzón de entrada (msg-001, msg-002, ...).",
      input_schema: { type: "object", properties: {} },
      run: async () => listarMensajes(deps.cfg).join(", "),
    },
    {
      name: "procesar_mensaje",
      description: "Procesa UN mensaje del buzón: clasifica, extrae datos con confianza, valida, actualiza el maestro y archiva. Devuelve el detalle de lo decidido.",
      input_schema: { type: "object", properties: { id: { type: "string", description: "Ej: msg-003" } }, required: ["id"] },
      run: async ({ id }) => {
        try { return formatearResultado(await procesarMensaje(String(id).toLowerCase(), deps)); }
        catch (e) { return `Error: ${(e as Error).message}`; }
      },
    },
    {
      name: "procesar_buzon",
      description: "Procesa TODOS los mensajes del buzón en orden y devuelve un resumen por mensaje.",
      input_schema: { type: "object", properties: {} },
      run: async () => {
        const salidas: string[] = [];
        for (const id of listarMensajes(deps.cfg)) salidas.push(formatearResultado(await procesarMensaje(id, deps)));
        return salidas.join("\n\n");
      },
    },
    {
      name: "reporte_vencimientos",
      description: "Genera el reporte de alertas de vencimiento de contratos (vencidos, ≤30, 31-60 y 61-90 días).",
      input_schema: { type: "object", properties: {} },
      run: async () => formatearReporte(reporteVencimientos(deps.repo.all(), deps.cfg.hoy)),
    },
    {
      name: "consultar_contrato",
      description: "Consulta un contrato del maestro por su id (ej. C-001).",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async ({ id }) => {
        const c = deps.repo.findById(String(id));
        if (!c) return `No existe el contrato ${id} en el maestro.`;
        return `${c.id_contrato} · ${c.cliente} · NIT ${c.nit} · ${formatoCOP(c.valor)} ${c.moneda} · ${c.fecha_inicio} → ${c.fecha_fin} · ${c.estado} · ${c.comercial_email}`;
      },
    },
    {
      name: "reiniciar_demo",
      description: "Restablece el maestro y las carpetas de salida al estado original (congelado al 30-may-2026).",
      input_schema: { type: "object", properties: {} },
      run: async () => { deps.repo.reset(); return "Maestro y salidas restablecidos al estado original."; },
    },
  ];
}
