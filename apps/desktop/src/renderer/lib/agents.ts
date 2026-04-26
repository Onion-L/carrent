import type { AgentRecord } from "../mock/uiShellData";

let idCounter = 0;

function newAgentId(): string {
  idCounter += 1;
  return `agent-${Date.now()}-${idCounter}`;
}

function formatISO(date: Date): string {
  return date.toISOString();
}

export function buildNewAgent(now = new Date()): AgentRecord {
  return {
    id: newAgentId(),
    name: "",
    runtime: "codex",
    responsibility: "",
    description: "",
    avatar: "",
    createdAt: formatISO(now),
    updatedAt: formatISO(now),
  };
}

export function validateAgent(agent: AgentRecord): string | null {
  if (!agent.name.trim()) {
    return "Name is required.";
  }

  if (!agent.responsibility.trim()) {
    return "Responsibility is required.";
  }

  if (agent.runtime !== "codex" && agent.runtime !== "claude-code" && agent.runtime !== "pi") {
    return "Runtime must be codex, claude-code, or pi.";
  }

  return null;
}

export function updateAgentInList(
  agents: AgentRecord[],
  agent: AgentRecord,
  now = new Date(),
): AgentRecord[] {
  const index = agents.findIndex((a) => a.id === agent.id);
  if (index === -1) {
    return agents;
  }

  const updated = agents.slice();
  updated[index] = { ...agent, updatedAt: formatISO(now) };
  return updated;
}

export function deleteAgentFromList(
  agents: AgentRecord[],
  agentId: string,
  selectedAgentId: string | null,
): { agents: AgentRecord[]; nextSelectedId: string | null } {
  const filtered = agents.filter((a) => a.id !== agentId);

  if (selectedAgentId === agentId) {
    return { agents: filtered, nextSelectedId: getSelectableAgentId(filtered) };
  }

  return { agents: filtered, nextSelectedId: selectedAgentId };
}

export function getSelectableAgentId(
  agents: AgentRecord[],
  preferredId?: string | null,
): string | null {
  if (agents.length === 0) {
    return null;
  }

  if (preferredId && agents.some((a) => a.id === preferredId)) {
    return preferredId;
  }

  return agents[0].id;
}
