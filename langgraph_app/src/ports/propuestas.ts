import type { EstadoPropuesta, Propuesta } from "../domain/types.ts";

/** Cola de recomendaciones pendientes de decisión humana. */
export interface PropuestasStore {
  get(msgId: string): Propuesta | null;
  list(estado?: EstadoPropuesta): Propuesta[];
  upsert(propuesta: Propuesta): void;
}
