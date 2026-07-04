import { CheckCircle2, ChevronDown, CircleDashed, TerminalSquare, XCircle } from "lucide-react";
import { useState } from "react";
import type { MessagePart } from "../../mock/uiShellData";

export type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
export type ShellPart = Extract<MessagePart, { type: "shell" }>;
export type AgentActivityStep = ReasoningPart | ShellPart;

const REASONING_COLLAPSE_THRESHOLD = 100;
const SHELL_COMMAND_COLLAPSE_THRESHOLD = 80;

export function getInitialAgentActivityBlockExpanded() {
  return false;
}

function getStepStatusMeta(step: AgentActivityStep) {
  if (step.type === "shell") {
    if (step.status === "failed") {
      return { icon: XCircle, className: "text-danger" };
    }
    if (step.status === "running") {
      return { icon: CircleDashed, className: "text-muted" };
    }
    return { icon: CheckCircle2, className: "text-subtle" };
  }

  if (step.status === "running") {
    return { icon: CircleDashed, className: "text-muted" };
  }
  return { icon: TerminalSquare, className: "text-subtle" };
}

export function getBlockStatusMeta(steps: AgentActivityStep[]) {
  const total = steps.length;
  const hasFailed = steps.some((step) => step.type === "shell" && step.status === "failed");
  const hasRunning = steps.some((step) => step.status === "running");

  if (hasFailed) {
    return {
      label: `${total} steps failed`,
      icon: XCircle,
      className: "text-danger",
    };
  }

  if (hasRunning) {
    return {
      label: `Running ${total} steps`,
      icon: CircleDashed,
      className: "text-muted",
    };
  }

  return {
    label: `${total} steps`,
    icon: CheckCircle2,
    className: "text-subtle",
  };
}

function ReasoningStepItem({ step }: { step: ReasoningPart }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getStepStatusMeta(step);
  const StatusIcon = meta.icon;
  const isRunning = step.status === "running";
  const hasMultipleLines = step.content.includes("\n");
  const isLong = step.content.length > REASONING_COLLAPSE_THRESHOLD;
  const canExpand = hasMultipleLines || isLong;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        className={`group flex w-full items-start gap-2.5 text-left ${canExpand ? "cursor-pointer" : "cursor-default"}`}
        aria-expanded={canExpand ? expanded : undefined}
      >
        <StatusIcon
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.className} ${isRunning ? "animate-spin" : ""}`}
        />
        <pre
          className={`flex-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-muted ${expanded ? "" : "line-clamp-1"}`}
        >
          {step.content}
        </pre>
        {canExpand && (
          <ChevronDown
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle transition group-hover:text-muted ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
    </div>
  );
}

function ShellStepItem({ step }: { step: ShellPart }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getStepStatusMeta(step);
  const StatusIcon = meta.icon;
  const isRunning = step.status === "running";
  const hasMultipleLines = step.command.includes("\n");
  const isLong = step.command.length > SHELL_COMMAND_COLLAPSE_THRESHOLD;
  const canExpand = hasMultipleLines || isLong || !!step.output;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        className={`group flex w-full items-start gap-2.5 text-left ${canExpand ? "cursor-pointer" : "cursor-default"}`}
        aria-expanded={canExpand ? expanded : undefined}
      >
        <StatusIcon
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.className} ${isRunning ? "animate-spin" : ""}`}
        />
        <pre
          className={`flex-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-muted ${expanded ? "" : "line-clamp-1"}`}
        >
          <span className="text-muted">$ </span>
          {step.command}
        </pre>
        {canExpand && (
          <ChevronDown
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle transition group-hover:text-muted ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {expanded && (
        <div className="pl-6">
          {step.output ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-code-bg p-3 font-mono text-[12px] leading-relaxed text-muted">
              {step.output}
            </pre>
          ) : isRunning ? (
            <div className="text-[12px] text-subtle">Running...</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StepItem({ step }: { step: AgentActivityStep }) {
  if (step.type === "reasoning") {
    return <ReasoningStepItem step={step} />;
  }
  return <ShellStepItem step={step} />;
}

export function AgentActivityBlock({ steps }: { steps: AgentActivityStep[] }) {
  const [expanded, setExpanded] = useState(getInitialAgentActivityBlockExpanded);
  const status = getBlockStatusMeta(steps);
  const StatusIcon = status.icon;
  const isRunning = steps.some((step) => step.status === "running");
  const total = steps.length;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-hover"
        aria-expanded={expanded}
      >
        <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-border px-1.5 text-[11px] font-semibold tabular-nums text-muted">
          {total}
        </span>
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${status.className} ${isRunning ? "animate-spin" : ""}`}
        />
        <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${status.className}`}>
          {status.label}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-subtle transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {steps.map((step) => (
            <StepItem key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
