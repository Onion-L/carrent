import { useState } from "react";
import { Button, Input, Textarea, Select } from "@carrent/ui";
import { Bot, Plus, Trash2 } from "lucide-react";
import { agents } from "../mock/uiShellData";

const runtimeOptions = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
] as const;

export function AgentsPage() {
  const [selectedAgentId, setSelectedAgentId] = useState(
    agents.find((a) => a.selected)?.id ?? agents[0]?.id,
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // Empty state placeholder (toggle via comment for now)
  // const agents = [];

  return (
    <div className="flex h-full w-full">
      {/* Agent list sidebar */}
      <div className="flex h-full w-[220px] flex-col border-r border-[#252525] bg-[#181818]">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
            Agents
          </span>
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#888] transition hover:bg-[#252525] hover:text-[#ccc]">
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
                    <span className="text-[13px] font-medium">{agent.name}</span>
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
        {selectedAgent ? (
          <div className="mx-auto w-full max-w-2xl p-6">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#252525]">
                  <Bot className="h-5 w-5 text-[#888]" />
                </div>
                <div>
                  <h2 className="text-[18px] font-semibold text-[#eee]">{selectedAgent.name}</h2>
                  <p className="text-[13px] text-[#666]">{selectedAgent.runtime}</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="gap-1.5 text-[#c44]">
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#aaa]">Name</label>
                <Input value={selectedAgent.name} readOnly className="bg-[#1e1e1e]" />
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#aaa]">
                  Responsibility Prompt
                </label>
                <Textarea
                  readOnly
                  className="min-h-32 bg-[#1e1e1e]"
                  value="You are a helpful assistant focused on this specific responsibility."
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-[#aaa]">
                  Default Runtime
                </label>
                <Select disabled className="bg-[#1e1e1e]" value={selectedAgent.runtime}>
                  {runtimeOptions.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="primary" size="sm">
                  Save Changes
                </Button>
                <Button variant="ghost" size="sm">
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
