export type AgentMode = "ask" | "auto-edit" | "full-project";

export const DEFAULT_AGENT_MODE: AgentMode = "ask";

export function isAgentMode(value: unknown): value is AgentMode {
  return value === "ask" || value === "auto-edit" || value === "full-project";
}

export function normalizeAgentMode(value: unknown): AgentMode {
  return isAgentMode(value) ? value : DEFAULT_AGENT_MODE;
}

export function getAgentModeLabel(mode: AgentMode) {
  switch (mode) {
    case "ask":
      return "Ask";
    case "auto-edit":
      return "Auto Edit";
    case "full-project":
      return "Full Project";
  }
}
