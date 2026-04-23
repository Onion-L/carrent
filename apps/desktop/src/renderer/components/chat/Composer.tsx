import { ArrowUp, ChevronDown, FolderGit, GitBranch } from "lucide-react";
import { useState } from "react";
import { agents } from "../../mock/uiShellData";

export function Composer() {
  const [input, setInput] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(
    agents.find((a) => a.selected)?.id ?? agents[0]?.id
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className="border-t border-[#2a2a2a] px-4 pb-3 pt-3">
      <div className="mx-auto max-w-3xl rounded-2xl border border-[#2f2f2f] bg-[#1e1e1e] p-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for follow-up changes or attach images"
          className="w-full resize-none bg-transparent text-[15px] text-[#ddd] placeholder-[#555] outline-none"
          rows={3}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Model selector */}
            <button className="flex items-center gap-1.5 rounded-md bg-[#252525] px-2.5 py-1 text-[13px] text-[#aaa] transition hover:bg-[#2f2f2f]">
              <span className="text-[#e87d5a]">✦</span>
              <span>GPT-5.4</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>

            <div className="h-4 w-px bg-[#333]" />

            <button className="flex items-center gap-1 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
              <span>Extra High</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>

            <div className="h-4 w-px bg-[#333]" />

            <button className="flex items-center gap-1 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
              <span>Build</span>
            </button>

            <div className="h-4 w-px bg-[#333]" />

            <button className="flex items-center gap-1 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
              <span>Full access</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#555]">30</span>
            <button
              disabled={!selectedAgentId}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4a6cf7] text-white transition hover:bg-[#3d5de4] disabled:opacity-40 disabled:hover:bg-[#4a6cf7]"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="mx-auto mt-2 flex max-w-3xl items-center justify-between px-1">
        <button className="flex items-center gap-1.5 text-[12px] text-[#666] transition hover:text-[#999]">
          <FolderGit className="h-3 w-3" />
          <span>Local checkout</span>
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
