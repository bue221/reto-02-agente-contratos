import { Annotation, MessagesAnnotation, MessagesZodState } from "@langchain/langgraph";
import type {
  AccionHumana,
  CampoEditable,
  Clasificacion,
  Comercial,
  Contrato,
  Correo,
  Decision,
  Extraccion,
  Validacion,
} from "./domain/types.ts";

/** Input visible en Studio: solo el id del mensaje. */
export const PipelineInputAnnotation = Annotation.Root({
  msgId: Annotation<string>,
});

/** Estado completo del pipeline. */
export const PipelineAnnotation = Annotation.Root({
  msgId: Annotation<string>,
  correo: Annotation<Correo | undefined>,
  clasificacion: Annotation<Clasificacion | undefined>,
  documento: Annotation<string | undefined>,
  extraccion: Annotation<Extraccion | undefined>,
  autor: Annotation<Comercial | undefined>,
  existente: Annotation<Contrato | undefined>,
  duplicadoDe: Annotation<string | undefined>,
  validaciones: Annotation<Validacion[]>({
    reducer: (_a, b) => b ?? [],
    default: () => [],
  }),
  decision: Annotation<Decision | undefined>,
  motivos: Annotation<string[]>({
    reducer: (_a, b) => b ?? [],
    default: () => [],
  }),
  contratoId: Annotation<string | undefined>,
  cambios: Annotation<Record<string, { antes: unknown; despues: unknown }>>({
    reducer: (_a, b) => b ?? {},
    default: () => ({}),
  }),
  archivos: Annotation<string[]>({
    reducer: (_a, b) => b ?? [],
    default: () => [],
  }),
  log: Annotation<string[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
});

export type PipelineState = typeof PipelineAnnotation.State;
export type PipelineUpdate = typeof PipelineAnnotation.Update;

/** Input del grafo `resolucion` (lo dispara un humano desde la tarjeta). */
export const ResolucionInputAnnotation = Annotation.Root({
  msgId: Annotation<string>,
  accion: Annotation<AccionHumana>,
  correcciones: Annotation<Partial<Record<CampoEditable, string>> | undefined>,
  comentario: Annotation<string | undefined>,
  aprobador: Annotation<string | undefined>,
});

/** Estado de la resolución: reutiliza el del pipeline para compartir nodos y reglas. */
export const ResolucionAnnotation = Annotation.Root({
  ...PipelineAnnotation.spec,
  accion: Annotation<AccionHumana>,
  correcciones: Annotation<Partial<Record<CampoEditable, string>> | undefined>,
  comentario: Annotation<string | undefined>,
  aprobador: Annotation<string | undefined>,
  recomendacion: Annotation<Decision | undefined>,
  bloqueado: Annotation<boolean | undefined>,
});

export type ResolucionState = typeof ResolucionAnnotation.State;
export type ResolucionUpdate = typeof ResolucionAnnotation.Update;

/**
 * Estado del chat para Studio.
 *
 * IMPORTANTE: debe ser MessagesZodState (con langgraph_type: "messages").
 * Si usamos Annotation custom sin MessagesZodMeta, Studio deja la pestaña
 * Chat en gris ("Unsupported type: never").
 *
 * La pestaña Chat = campo para escribir el turno; `messages` acumula el historial.
 */
export const ChatStateSchema = MessagesZodState;
export type ChatState = {
  messages: import("@langchain/core/messages").BaseMessage[];
};

/** Alias legacy. */
export { MessagesAnnotation, MessagesZodState };
