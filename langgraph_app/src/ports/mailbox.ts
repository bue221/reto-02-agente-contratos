/**
 * Puerto de buzón: el núcleo no conoce fixtures vs IMAP/Graph.
 * Hoy: FixturesMailbox. Mañana: ImapMailbox / GraphMailbox.
 */
import type { Correo } from "../types.ts";

export interface MailboxStats {
  total: number;
  procesados: number;
  pendientes: number;
}

export interface MailboxPort {
  listIds(): string[];
  getMessage(id: string): Correo;
  markProcessed(id: string): void;
  listPending(): string[];
  listProcessed(): string[];
  stats(): MailboxStats;
  /** Limpia tracking de procesados (p.ej. reiniciar_demo). */
  resetProcessed(): void;
}
