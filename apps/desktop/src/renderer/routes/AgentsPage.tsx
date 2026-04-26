import { useEffect, useState } from "react";
import { Button, Input, Textarea, Select } from "@carrent/ui";
import { Bot, Plus, Trash2 } from "lucide-react";
import { useAgents } from "../context/AgentContext";
import type { AgentRecord } from "../mock/uiShellData";

const runtimeOptions = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
] as const;

export function AgentsPage() {
  const {
    agents,
    selectedAgentId,
    selectedAgent,
    setSelectedAgentId,
    createAgent,
    updateAgent,
    deleteAgent,
  } = useAgents();

  const [draft, setDraft] = useState<AgentRecord | null>(null);

  useEffect(() => {
    if (selectedAgent) {
      setDraft({ ...selectedAgent });
    } else {
      setDraft(null);
    }
  }, [selectedAgent]);

  const handleCreate = () => {
    const agent = createAgent();
    setSelectedAgentId(agent.id);
  };

  const handleDelete = () => {
    if (!selectedAgentId) return;
    deleteAgent(selectedAgentId);
  };

  const handleSave = () => {
    if (!draft) return;
    const result = updateAgent(draft);
    if (!result.ok) {
      // Error is already captured by validation in the form
    }
  };

  const handleCancel = () => {
    if (selectedAgent) {
      setDraft({ ...selectedAgent });
    }
  };

  return (
    <div className="flex h-full w-full">
      {/* Agent list sidebar */}
      <div className="flex h-full w-[220px] flex-col border-r border-[#252525] bg-[#181818]">
        <div className="drag-region flex items-center justify-between px-3 py-3">
          <span className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
            Agents
          </span>
          <button
            onClick={handleCreate}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#888] transition hover:bg-[#252525] hover:text-[#ccc]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-2">
          {agents.length === 0 ? (
            <div className="px-2 py-6 text-center">
              <p className="text-[13px] text-[#555]">No agents configured</p>
            </div>
          ) : (
            agents.map((agent) => {
              const isActive = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                    isActive
                      ? "bg-[#2a2a2a] text-[#eee]"
                      : "text-[#999] hover:bg-[#222] hover:text-[#ccc]"
                  }`}
                >
                  <Bot className="h-4 w-4 shrink-0" />
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-medium">{agent.name || "New Agent"}</span>
                    <span className="text-[11px] text-[#666]">{agent.runtime}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Agent detail */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto bg-[#181818]">
        <div
          className="drag-region shrink-0"
          style={{ height: "env(titlebar-area-height, 38px)" }}
        />
        {draft ? (
          <div className="mx-auto w-full max-w-2xl p-6">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#252525]">
                  <Bot className="h-5 w-5 text-[#888]" />
                </div>
                <div>
                  <h2 className="text-[18px] font-semibold text-[#eee]">
                    {draft.name || "New Agent"}
                  </h2>
                  <p className="text-[13px] text-[#666]">{draft.runtime}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5 text-[#c44]"
                onClick={handleDelete}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#aaa]">Name</label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                  className="bg-[#1e1e1e]"
                  placeholder="Agent name"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#aaa]">
                  Responsibility Prompt
                </label>
                <Textarea
                  className="min-h-32 bg-[#1e1e1e]"
                  value={draft.responsibility}
                  onChange={(e) =>
                    setDraft((prev) => (prev ? { ...prev, responsibility: e.target.value } : prev))
                  }
                  placeholder="Describe the agent's role and behavior..."
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#aaa]">
                  Default Runtime
                </label>
                <Select
                  className="bg-[#1e1e1e]"
                  value={draft.runtime}
                  onChange={(e) =>
                    setDraft((prev) =>
                      prev
                        ? { ...prev, runtime: e.target.value as AgentRecord["runtime"] }
                        : prev,
                    )
                  }
                >
                  {runtimeOptions.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="primary" size="sm" onClick={handleSave}>
                  Save Changes
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[#555]">
            <Bot className="h-10 w-10" />
            <p className="text-[15px]">Select an agent to edit</p>
            <p className="text-[13px]">Or create a new agent to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
