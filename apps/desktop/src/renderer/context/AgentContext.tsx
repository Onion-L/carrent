import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWorkspace } from "./WorkspaceContext";
import {
  buildNewAgent,
  deleteAgentFromList,
  getSelectableAgentId,
  updateAgentInList,
  validateAgent,
} from "../lib/agents";
import type { AgentRecord } from "../mock/uiShellData";

export type AgentContextValue = {
  agents: AgentRecord[];
  selectedAgentId: string | null;
  selectedAgent: AgentRecord | null;
  setSelectedAgentId: (id: string | null) => void;
  createAgent: (overrides?: Partial<AgentRecord>) => AgentRecord;
  updateAgent: (agent: AgentRecord) => { ok: true } | { ok: false; error: string };
  deleteAgent: (agentId: string) => void;
};

const AgentContext = createContext<AgentContextValue>({
  agents: [],
  selectedAgentId: null,
  selectedAgent: null,
  setSelectedAgentId: () => {},
  createAgent: () => buildNewAgent(),
  updateAgent: () => ({ ok: true }),
  deleteAgent: () => {},
});

export function AgentProvider({ children }: { children: ReactNode }) {
  const { agents, setAgents } = useWorkspace();

  const selectedAgentId = useMemo(
    () => getSelectableAgentId(agents, agents.find((a) => a.selected)?.id),
    [agents],
  );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const setSelectedAgentId = (id: string | null) => {
    const nextId = getSelectableAgentId(agents, id);
    setAgents((prev) =>
      prev.map((a) => ({
        ...a,
        selected: a.id === nextId,
      })),
    );
  };

  const createAgent = (overrides?: Partial<AgentRecord>) => {
    const agent = buildNewAgent(overrides);
    setAgents((prev) => [...prev, agent]);
    return agent;
  };

  const updateAgent = (agent: AgentRecord) => {
    const error = validateAgent(agent);
    if (error) {
      return { ok: false as const, error };
    }

    setAgents((prev) => {
      const updated = updateAgentInList(prev, agent);
      if (updated === prev) {
        return [...prev, agent];
      }
      return updated;
    });
    return { ok: true as const };
  };

  const deleteAgent = (agentId: string) => {
    setAgents((prev) => {
      const result = deleteAgentFromList(prev, agentId, selectedAgentId);
      return result.agents;
    });
  };

  return (
    <AgentContext.Provider
      value={{
        agents,
        selectedAgentId,
        selectedAgent,
        setSelectedAgentId,
        createAgent,
        updateAgent,
        deleteAgent,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useAgents() {
  return useContext(AgentContext);
}
