import { ArrowUp, ChevronDown, FolderGit, GitBranch, Hand, Plus } from "lucide-react";
import { useState } from "react";
import { agents, currentProject } from "../../mock/uiShellData";

export function Composer() {
  const [input, setInput] = useState("");
  const [selectedAgentId] = useState(
    agents.find((a) => a.selected)?.id ?? agents[0]?.id
  );

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#333] bg-[#252525] p-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Codex, @ add files, / enter commands, $ use skills"
          className="w-full resize-none bg-transparent text-[14px] text-[#ddd] placeholder-[#666] outline-none"
          rows={3}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#888] transition hover:bg-[#333] hover:text-[#ccc]">
              <Plus className="h-4 w-4" />
            </button>
            <button className="flex items-center gap-1 rounded-md bg-[#333] px-2 py-1 text-[12px] text-[#aaa] transition hover:bg-[#3a3a3a]">
              <Hand className="h-3 w-3" />
              <span>Default Access</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[#333] px-2 py-1 text-[12px] text-[#888]">
              aigocode_codex
            </span>
            <button className="flex items-center gap-1 rounded-md bg-[#333] px-2 py-1 text-[12px] text-[#aaa] transition hover:bg-[#3a3a3a]">
              <span>GPT-5.4</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>
            <button className="flex items-center gap-1 rounded-md bg-[#333] px-2 py-1 text-[12px] text-[#aaa] transition hover:bg-[#3a3a3a]">
              <span>Ultra High</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>
            <button
              disabled={!selectedAgentId}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4a6cf7] text-white transition hover:bg-[#3d5de4] disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="mx-auto mt-2 flex max-w-2xl items-center gap-4 px-1">
        <button className="flex items-center gap-1.5 text-[12px] text-[#666] transition hover:text-[#999]">
          <FolderGit className="h-3 w-3" />
          <span>{currentProject.name}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
        <button className="flex items-center gap-1.5 text-[12px] text-[#666] transition hover:text-[#999]">
          <span>Local</span>
          <ChevronDown className="h-3 w-3" />
        </button>
        <button className="flex items-center gap-1 text-[12px] text-[#666] transition hover:text-[#999]">
          <GitBranch className="h-3 w-3" />
          <span>main</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
