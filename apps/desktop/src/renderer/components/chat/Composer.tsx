import { ArrowUp, ChevronDown } from "lucide-react";
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
      <div className="mx-auto max-w-3xl rounded-xl border border-[#2f2f2f] bg-[#1e1e1e] p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for follow-up changes or attach images"
          className="w-full resize-none bg-transparent text-[15px] text-[#ddd] placeholder-[#555] outline-none"
          rows={3}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Agent selector */}
            <button className="flex items-center gap-1.5 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
              <span>{selectedAgent?.name ?? "Select agent"}</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>
            <div className="h-3.5 w-px bg-[#333]" />
            <span className="text-[12px] text-[#555]">UI shell only</span>
          </div>
          <button
            disabled={!selectedAgentId}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4a6cf7] text-white transition hover:bg-[#3d5de4] disabled:opacity-40 disabled:hover:bg-[#4a6cf7]"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
