import { PREFIJO_REQUIERE_REVISION, type Registro } from "../use-cases/register.ts";
import { type ValidacionReportada, requiereConfirmacion } from "../use-cases/validate.ts";
import type { CampoContrato, Contrato } from "../../core/domain/contract.ts";
import { mensajeDeError } from "../../core/domain/result.ts";
import type { Clasificacion } from "../../core/rules/classify.ts";
import type { ContextoHerramienta } from "../../tools/tool.ts";
import { llamarHerramienta } from "./tool-call.ts";

/**
 * Grafo determinista de un mensaje del buzón. El modelo no elige el camino: cada nodo llama a una
 * herramienta `contratos_*` y la arista siguiente sale solo de su resultado.
 *
 *   extraer ─▶ validar ─▶ decidir ─┬─▶ registrar          nuevo / actualización sin campos dudosos
 *                                  ├─▶ esperar_revision   pausa humana: se reanuda con aprobar o rechazar
 *                                  └─▶ cerrar             duplicado / rechazado
 *
 * Un error en cualquier nodo termina solo este mensaje (HU-6): el lote sigue. La tabla `NODOS` es la
 * única definición del grafo: la recorren `ejecutarGrafoMensaje` y el grafo de LangGraph de `studio/`.
 */

export type NodoMensaje = "extraer" | "validar" | "decidir" | "registrar" | "esperar_revision" | "cerrar";

export const NODO_INICIAL: NodoMensaje = "extraer";

export type Desenlace = "registrado" | "en_revision" | "cerrado" | "error";

export interface CampoEnRevision {
  campo: CampoContrato;
  valor: Contrato[CampoContrato]["valor"];
  confianza: number;
  evidencia: string | null;
  motivo: string;
}

export interface ResultadoMensaje {
  mensaje_id: string;
  desenlace: Desenlace;
  clasificacion: Clasificacion | null;
  id_contrato: string | null;
  requiere_revision: CampoContrato[];
  /** Lo que espera confirmación humana, campo por campo, con la evidencia literal del documento. */
  revision: CampoEnRevision[];
  accion: string;
  avisos: string[];
  /** Nodos visitados en orden: explica por qué el mensaje terminó donde terminó. */
  recorrido: NodoMensaje[];
  contrato: Contrato | null;
}

/** Estado de un mensaje mientras recorre el grafo; `resultado` se fija al llegar a un nodo final. Es JSON puro. */
export interface EstadoMensaje {
  mensajeId: string;
  recorrido: NodoMensaje[];
  contrato: Contrato | null;
  validacion: ValidacionReportada | null;
  resultado: ResultadoMensaje | null;
}

/** Lo que devuelve un nodo: el estado nuevo y la arista a seguir (`null` = fin del mensaje). */
export interface Transicion {
  estado: EstadoMensaje;
  siguiente: NodoMensaje | null;
}

export type Nodo = (estado: EstadoMensaje, ctx: ContextoHerramienta) => Promise<Transicion>;

export const estadoInicial = (mensajeId: string): EstadoMensaje => ({ mensajeId, recorrido: [], contrato: null, validacion: null, resultado: null });

/** Arista condicional del nodo `decidir`: función pura de la validación, sin intervención del modelo. */
export function rutaTrasValidar(validacion: Pick<ValidacionReportada, "clasificacion" | "requiere_revision">): "registrar" | "esperar_revision" | "cerrar" {
  if (validacion.clasificacion === "duplicado" || validacion.clasificacion === "rechazado") return "cerrar";
  return requiereConfirmacion(validacion) ? "esperar_revision" : "registrar";
}

function resultadoDe(estado: EstadoMensaje, desenlace: Desenlace, accion: string, extra: Partial<ResultadoMensaje> = {}): ResultadoMensaje {
  const { validacion, contrato } = estado;
  return {
    mensaje_id: estado.mensajeId,
    desenlace,
    clasificacion: validacion?.clasificacion ?? null,
    id_contrato: validacion?.id_contrato_existente ?? contrato?.id_contrato.valor ?? null,
    requiere_revision: validacion?.requiere_revision ?? [],
    revision: [],
    accion,
    avisos: validacion?.avisos ?? [],
    recorrido: estado.recorrido,
    contrato,
    ...extra,
  };
}

const terminar = (estado: EstadoMensaje, desenlace: Desenlace, accion: string, extra: Partial<ResultadoMensaje> = {}): Transicion => ({
  estado: { ...estado, resultado: resultadoDe(estado, desenlace, accion, extra) },
  siguiente: null,
});

const continuar = (estado: EstadoMensaje, siguiente: NodoMensaje): Transicion => ({ estado, siguiente });

/** Cada nodo anota su paso en el recorrido antes de actuar. */
const visitar = (estado: EstadoMensaje, nodo: NodoMensaje): EstadoMensaje => ({ ...estado, recorrido: [...estado.recorrido, nodo] });

/** Mensaje que ni siquiera entra al grafo (p. ej. un correo ilegible al ingestar). */
export const mensajeConError = (mensajeId: string, error: string): ResultadoMensaje =>
  resultadoDe(estadoInicial(mensajeId), "error", `error: ${error}`);

/** El grafo garantiza el orden: un nodo que recibe un estado incompleto es un error de programación, no de datos. */
function requerir<T>(valor: T | null, nodo: NodoMensaje): T {
  if (valor === null) throw new Error(`el nodo ${nodo} se alcanzó sin el estado que necesita`);
  return valor;
}

function esperarRevision(estado: EstadoMensaje): Transicion {
  const contrato = requerir(estado.contrato, "esperar_revision");
  const validacion = requerir(estado.validacion, "esperar_revision");
  const revision = validacion.revisiones.map(({ campo, motivo }) => {
    const { valor, confianza, evidencia } = contrato[campo];
    return { campo, valor, confianza, evidencia: evidencia ?? null, motivo };
  });
  return terminar(estado, "en_revision", `en espera de confirmación humana: ${validacion.requiere_revision.join(", ")}`, { revision });
}

export const NODOS: Readonly<Record<NodoMensaje, Nodo>> = {
  async extraer(previo, ctx) {
    const estado = visitar(previo, "extraer");
    const extraido = await llamarHerramienta<Contrato>("contratos_extraer", { mensaje_id: estado.mensajeId }, ctx);
    return extraido.ok ? continuar({ ...estado, contrato: extraido.data }, "validar") : terminar(estado, "error", `error: ${extraido.error}`);
  },

  async validar(previo, ctx) {
    const estado = visitar(previo, "validar");
    const contrato = requerir(estado.contrato, "validar");
    const validacion = await llamarHerramienta<ValidacionReportada>("contratos_validar", { mensaje_id: estado.mensajeId, contrato }, ctx);
    return validacion.ok ? continuar({ ...estado, validacion: validacion.data }, "decidir") : terminar(estado, "error", `error: ${validacion.error}`);
  },

  async decidir(previo) {
    const estado = visitar(previo, "decidir");
    return continuar(estado, rutaTrasValidar(requerir(estado.validacion, "decidir")));
  },

  async registrar(previo, ctx) {
    const estado = visitar(previo, "registrar");
    const contrato = requerir(estado.contrato, "registrar");
    const registro = await llamarHerramienta<Registro>("contratos_registrar", { mensaje_id: estado.mensajeId, contrato }, ctx);
    if (registro.ok) {
      const { accion, id_contrato, ruta_archivo } = registro.data;
      if (accion === "duplicado") return terminar(estado, "cerrado", `sin escritura (duplicado de ${id_contrato})`, { id_contrato });
      return terminar(estado, "registrado", `${accion} ${id_contrato} → ${ruta_archivo}`, { id_contrato });
    }
    // `registrar` revalida en el servidor: si encuentra dudas, el mensaje se pausa igual que desde `decidir`.
    if (registro.error.startsWith(PREFIJO_REQUIERE_REVISION)) return continuar(estado, "esperar_revision");
    return terminar(estado, "error", `sin registrar: ${registro.error}`);
  },

  async esperar_revision(previo) {
    return esperarRevision(visitar(previo, "esperar_revision"));
  },

  async cerrar(previo) {
    const estado = visitar(previo, "cerrar");
    const validacion = requerir(estado.validacion, "cerrar");
    const motivo = validacion.motivo ?? validacion.clasificacion;
    return terminar(estado, "cerrado", validacion.clasificacion === "rechazado" ? `rechazado: ${motivo}` : `sin escritura: ${motivo}`);
  },
};

/** Topología del grafo: a qué nodos puede seguir cada uno (`null` = fin del mensaje). La dibuja Studio y la verifican los tests. */
export const ARISTAS: Readonly<Record<NodoMensaje, readonly (NodoMensaje | null)[]>> = {
  extraer: ["validar", null],
  validar: ["decidir", null],
  decidir: ["registrar", "esperar_revision", "cerrar"],
  registrar: ["esperar_revision", null],
  esperar_revision: [null],
  cerrar: [null],
};

/** El grafo es acíclico: ningún mensaje puede visitar más nodos que estos (registrar → esperar_revision es el más largo). */
const MAX_PASOS = Object.keys(NODOS).length;

export async function ejecutarGrafoMensaje(mensajeId: string, ctx: ContextoHerramienta): Promise<ResultadoMensaje> {
  let transicion: Transicion = { estado: estadoInicial(mensajeId), siguiente: NODO_INICIAL };
  for (let paso = 0; transicion.siguiente && paso < MAX_PASOS; paso++) {
    transicion = await NODOS[transicion.siguiente](transicion.estado, ctx).catch(
      (error: unknown): Transicion => terminar(transicion.estado, "error", `error interno: ${mensajeDeError(error)}`),
    );
  }
  return transicion.estado.resultado ?? resultadoDe(transicion.estado, "error", "error interno: el grafo no llegó a un nodo final");
}
