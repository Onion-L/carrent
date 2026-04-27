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
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 bg-surface-raised px-3 py-2 text-left transition hover:bg-surface-hover"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-fg">
          <Brain className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="shrink-0">Thinking</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          {reasoning.status === "running" && (
            <CircleDashed className="h-3.5 w-3.5 animate-spin text-warning" />
          )}
          <span>{reasoning.status}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="px-3 py-3">
          {reasoning.content ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted">
              {reasoning.content}
            </pre>
          ) : (
            <div className="text-[12px] text-subtle">Thinking...</div>
          )}
        </div>
      )}
    </div>
  );
}
