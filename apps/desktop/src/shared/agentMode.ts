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
      return "Auto";
    case "full-project":
      return "Full Access";
  }
}

export function getAgentModeDescription(mode: AgentMode) {
  switch (mode) {
    case "ask":
      return "Approve every write and command";
    case "auto-edit":
      return "Write and run safe commands inside the project";
    case "full-project":
      return "Full access inside the project, including deletes";
  }
}
