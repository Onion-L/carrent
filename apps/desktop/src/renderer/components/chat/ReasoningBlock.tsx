import { Brain, ChevronDown, CircleDashed } from "lucide-react";
import { useState } from "react";
import type { MessagePart } from "../../mock/uiShellData";

type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;

export function getInitialReasoningBlockExpanded() {
  return false;
}

export function ReasoningBlock({ reasoning }: { reasoning: ReasoningPart }) {
  const [expanded, setExpanded] = useState(getInitialReasoningBlockExpanded);

  return (
    <div className="overflow-hidden rounded-xl border border-[#303030] bg-[#151515]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 bg-[#1c1c1c] px-3 py-2 text-left transition hover:bg-[#222]"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-[#d5d5d5]">
          <Brain className="h-3.5 w-3.5 shrink-0 text-[#888]" />
          <span className="shrink-0">Thinking</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#777]">
          {reasoning.status === "running" && (
            <CircleDashed className="h-3.5 w-3.5 animate-spin text-[#d7aa55]" />
          )}
          <span>{reasoning.status}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {expanded && (
        <div className="px-3 py-3">
          {reasoning.content ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[#a9a9a9]">
              {reasoning.content}
            </pre>
          ) : (
            <div className="text-[12px] text-[#666]">Thinking...</div>
          )}
        </div>
      )}
    </div>
  );
}
