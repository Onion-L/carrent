import { ChevronDown, CircleDashed, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { MessagePart } from "../../mock/uiShellData";

type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;

export function getInitialReasoningBlockExpanded() {
  return false;
}

export function ReasoningBlock({ reasoning }: { reasoning: ReasoningPart | ReasoningPart[] }) {
  const parts = Array.isArray(reasoning) ? reasoning : [reasoning];
  const [expanded, setExpanded] = useState(getInitialReasoningBlockExpanded);
  const isRunning = parts.some((part) => part.status === "running");
  const label = isRunning ? "Thinking" : "Thought";
  const content = parts.map((part) => part.content).join("\n\n");

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-2 text-left text-[13px] text-subtle transition hover:text-muted"
        aria-expanded={expanded}
      >
        {isRunning ? (
          <CircleDashed className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
        ) : (
          <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-subtle group-hover:text-muted" />
        )}
        <span className="min-w-0 truncate font-medium">{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 border-l border-border pl-5">
          {content ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-6 text-muted">
              {content}
            </pre>
          ) : (
            <div className="text-[13px] text-subtle">Thinking...</div>
          )}
        </div>
      )}
    </div>
  );
}
