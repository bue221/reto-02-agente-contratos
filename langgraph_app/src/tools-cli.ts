import { getCfg, getRepo, resetDeps } from "./deps.ts";
import { formatearPropuesta } from "./hitl/format.ts";
import { aprobarRecomendadasDemo } from "./hitl/service.ts";
import { formatearReporte, reporteVencimientos } from "./report.ts";
import { ejecutarPipelineBuzon } from "./tools/contratos.ts";

/** Helpers CLI/demo que reutilizan el mismo núcleo que las tools y la API. */
export function crearHerramientas() {
  return {
    procesarBuzon: () => ejecutarPipelineBuzon(),
    /** Simula al humano: aprueba todo salvo lo que pide revisión de datos. */
    aprobarDemo: async () => {
      const resueltas = await aprobarRecomendadasDemo();
      return resueltas.map(formatearPropuesta).join("\n\n");
    },
    reporte: async () => formatearReporte(reporteVencimientos(getRepo().all(), getCfg().hoy)),
    reset: () => {
      resetDeps();
      return "ok";
    },
  };
}
