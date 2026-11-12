/**
 * Caso de uso "un humano resuelve una propuesta". Lo consumen la API y la demo.
 * El agente (chat/tools) NO importa este módulo: no puede aprobar.
 */
import { getPropuestas } from "../deps.ts";
import { AppError } from "../domain/errors.ts";
import type { AccionHumana, CampoEditable, Propuesta } from "../domain/types.ts";
import { formatearPropuesta } from "./format.ts";
import { graph as resolucionGraph } from "./resolucion-graph.ts";

export interface ResolverInput {
  accion: AccionHumana;
  correcciones?: Partial<Record<CampoEditable, string>>;
  comentario?: string;
  aprobador?: string;
}

export interface ResultadoResolucion {
  propuesta: Propuesta;
  texto: string;
}

// Evita doble ejecución por doble clic o dos pestañas resolviendo a la vez.
const enCurso = new Set<string>();

export async function resolverPropuesta(
  msgId: string,
  input: ResolverInput,
): Promise<ResultadoResolucion> {
  const id = msgId.trim().toLowerCase();
  const store = getPropuestas();
  const actual = store.get(id);
  if (!actual) throw new AppError("NOT_FOUND", `No hay propuesta para ${id}`, 404);
  if (actual.estado !== "PENDIENTE") {
    throw new AppError("YA_RESUELTA", `La propuesta ${id} ya fue ${actual.estado.toLowerCase()}`, 409);
  }
  if (enCurso.has(id)) {
    throw new AppError("EN_CURSO", `La propuesta ${id} se está resolviendo`, 409);
  }

  enCurso.add(id);
  try {
    const result = await resolucionGraph.invoke({ msgId: id, ...input });
    if (result.bloqueado) {
      throw new AppError(
        "BLOQUEADO_POR_REGLAS",
        "Las reglas no permiten ejecutar esta aprobación. Corrige los datos o recházala.",
        422,
        { decision: result.decision, motivos: result.motivos ?? [] },
      );
    }
    const propuesta = store.get(id)!;
    console.info(
      `[hitl] ${id} ${input.accion} por ${input.aprobador ?? "humano"} → ${propuesta.resolucion?.decisionFinal}`,
    );
    return { propuesta, texto: formatearPropuesta(propuesta) };
  } finally {
    enCurso.delete(id);
  }
}

/**
 * Solo para demo/CLI: simula a un humano aprobando todo lo que no pide revisión de datos.
 * Las recomendaciones REVISION_HUMANA quedan pendientes a propósito.
 */
export async function aprobarRecomendadasDemo(aprobador = "demo-script"): Promise<Propuesta[]> {
  const resueltas: Propuesta[] = [];
  for (const p of getPropuestas().list("PENDIENTE")) {
    if (p.recomendacion === "REVISION_HUMANA") continue;
    const { propuesta } = await resolverPropuesta(p.msgId, {
      accion: "aprobar",
      aprobador,
      comentario: "Aprobación automática de la demo",
    });
    resueltas.push(propuesta);
  }
  return resueltas;
}
