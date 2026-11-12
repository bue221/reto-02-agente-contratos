/** Re-export: prompts viven en prompts/*.md */
export {
  loadAgentHelpPrompt as AGENT_HELP_FN,
  loadAgentSystemPrompt as AGENT_SYSTEM_PROMPT_FN,
  loadAgentHelpPrompt,
  loadAgentSystemPrompt,
} from "./load-prompt.ts";

import { loadAgentHelpPrompt, loadAgentSystemPrompt } from "./load-prompt.ts";

/** Compat: strings cargados al importar el módulo. */
export const AGENT_SYSTEM_PROMPT = loadAgentSystemPrompt();
export const AGENT_HELP = loadAgentHelpPrompt();
