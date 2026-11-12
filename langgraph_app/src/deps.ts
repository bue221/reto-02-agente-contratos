import { JsonlAuditStore } from "./adapters/audit-store.ts";
import { FixturesMailbox } from "./adapters/fixtures-mailbox.ts";
import { MasterRepository } from "./adapters/master.ts";
import { JsonPropuestasStore } from "./adapters/propuestas-store.ts";
import { loadConfig, type Config } from "./config.ts";
import type { AuditStore } from "./ports/audit.ts";
import type { MailboxPort } from "./ports/mailbox.ts";
import type { PropuestasStore } from "./ports/propuestas.ts";

let cfg: Config | null = null;
let repo: MasterRepository | null = null;
let mailbox: MailboxPort | null = null;
let audit: AuditStore | null = null;
let propuestas: PropuestasStore | null = null;

export function getCfg(): Config {
  if (!cfg) cfg = loadConfig();
  return cfg;
}

export function getRepo(): MasterRepository {
  if (!repo) repo = new MasterRepository(getCfg());
  return repo;
}

export function getMailbox(): MailboxPort {
  if (!mailbox) mailbox = new FixturesMailbox(getCfg());
  return mailbox;
}

export function getAudit(): AuditStore {
  if (!audit) audit = new JsonlAuditStore(getCfg());
  return audit;
}

export function getPropuestas(): PropuestasStore {
  if (!propuestas) propuestas = new JsonPropuestasStore(getCfg());
  return propuestas;
}

export function resetDeps(): void {
  cfg = loadConfig();
  // MasterRepository.reset() borra outDir entero (procesados, auditoría, propuestas).
  repo = new MasterRepository(cfg);
  repo.reset();
  mailbox = new FixturesMailbox(cfg);
  mailbox.resetProcessed();
  audit = new JsonlAuditStore(cfg);
  propuestas = new JsonPropuestasStore(cfg);
}
