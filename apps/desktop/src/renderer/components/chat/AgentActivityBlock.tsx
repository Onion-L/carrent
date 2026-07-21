import { CheckCircle2, ChevronRight, CircleDashed, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { MessagePart } from "../../mock/uiShellData";

export type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
export type ShellPart = Extract<MessagePart, { type: "shell" }>;
export type CommentaryPart = {
  type: "commentary";
  id: string;
  content: string;
};
export type AgentActivityStep = ReasoningPart | ShellPart;
export type AgentActivityItem = AgentActivityStep | CommentaryPart;
export type AgentActivityStatus = "running" | "completed" | "failed" | "cancelled";

const SHELL_COMMAND_COLLAPSE_THRESHOLD = 80;

export function formatAgentActivityDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    return `${days}d ${padDurationPart(hours)}h ${padDurationPart(minutes)}m ${padDurationPart(seconds)}s`;
  }

  if (totalHours > 0) {
    return `${totalHours}h ${padDurationPart(minutes)}m ${padDurationPart(seconds)}s`;
  }

  if (totalMinutes > 0) {
    return `${totalMinutes}m ${padDurationPart(seconds)}s`;
  }

  return `${seconds}s`;
}

function padDurationPart(value: number) {
  return value.toString().padStart(2, "0");
}

export function inferAgentActivityStatus(steps: AgentActivityStep[]): AgentActivityStatus {
  if (steps.some((step) => step.type === "shell" && step.status === "failed")) {
    return "failed";
  }

  if (steps.some((step) => step.status === "running")) {
    return "running";
  }

  return "completed";
}

export function getInitialAgentActivityBlockExpanded({
  status,
  hasFinalAnswerStarted,
}: {
  status: AgentActivityStatus;
  hasFinalAnswerStarted: boolean;
}) {
  return status === "running" && !hasFinalAnswerStarted;
}

function getStepStatusMeta(step: AgentActivityStep) {
  if (step.status === "running") {
    return { icon: CircleDashed, className: "text-muted" };
  }

  if (step.status === "cancelled") {
    return { icon: XCircle, className: "text-muted" };
  }

  if (step.type === "shell" && step.status === "failed") {
    return { icon: XCircle, className: "text-danger" };
  }

  return { icon: CheckCircle2, className: "text-subtle" };
}

export function getBlockStatusMeta(
  steps: AgentActivityStep[],
  status: AgentActivityStatus = inferAgentActivityStatus(steps),
) {
  if (status === "failed") {
    return {
      label: "Failed",
      icon: XCircle,
      className: "text-danger",
    };
  }

  if (status === "cancelled") {
    return {
      label: "Cancelled",
      icon: XCircle,
      className: "text-muted",
    };
  }

  if (status === "running") {
    return {
      label: "Thinking",
      icon: CircleDashed,
      className: "text-muted",
    };
  }

  return {
    label: "Completed",
    icon: CheckCircle2,
    className: "text-subtle",
  };
}

export function getBlockTitle({
  status,
  duration,
}: {
  status: AgentActivityStatus;
  duration?: string;
}) {
  const label = getBlockStatusMeta([], status).label;
  return duration ? `${label} · ${duration}` : label;
}

function ReasoningStepItem({ step }: { step: ReasoningPart }) {
  const meta = getStepStatusMeta(step);
  const StatusIcon = meta.icon;
  const isRunning = step.status === "running";

  return (
    <div className="flex w-full items-start gap-2.5">
      <StatusIcon
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.className} ${isRunning ? "animate-spin" : ""}`}
      />
      <pre className="flex-1 whitespace-pre-wrap break-words text-app-12 leading-5 text-muted">
        {step.content}
      </pre>
    </div>
  );
}

function CommentaryItem({ item }: { item: CommentaryPart }) {
  return (
    <p className="whitespace-pre-wrap break-words text-app-14 font-medium leading-6 text-muted">
      {item.content}
    </p>
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
          className={`flex-1 whitespace-pre-wrap break-words font-mono text-app-12 leading-5 text-muted ${expanded ? "" : "line-clamp-1"}`}
        >
          <span className="text-muted">$ </span>
          {step.command}
        </pre>
        {canExpand && (
          <ChevronRight
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle transition group-hover:text-muted ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {expanded && (
        <div className="pl-6">
          {step.output ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-code-bg p-3 font-mono text-app-12 leading-relaxed text-muted">
              {step.output}
            </pre>
          ) : isRunning ? (
            <div className="text-app-12 text-subtle">Running...</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ActivityItem({ item }: { item: AgentActivityItem }) {
  if (item.type === "commentary") {
    return <CommentaryItem item={item} />;
  }
  if (item.type === "reasoning") {
    return <ReasoningStepItem step={item} />;
  }
  return <ShellStepItem step={item} />;
}

export function AgentActivityBlock({
  items,
  status: explicitStatus,
  startedAt,
  finishedAt,
  duration,
  hasFinalAnswerStarted = false,
}: {
  items: AgentActivityItem[];
  status?: AgentActivityStatus;
  startedAt?: number;
  finishedAt?: number;
  duration?: string;
  hasFinalAnswerStarted?: boolean;
}) {
  const steps = items.filter((item): item is AgentActivityStep => item.type !== "commentary");
  const resolvedStatus = explicitStatus ?? inferAgentActivityStatus(steps);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(() =>
    getInitialAgentActivityBlockExpanded({
      status: resolvedStatus,
      hasFinalAnswerStarted,
    }),
  );
  const shouldCollapse = resolvedStatus !== "running" || hasFinalAnswerStarted;

  useEffect(() => {
    if (shouldCollapse) {
      setExpanded(false);
    }
  }, [shouldCollapse]);

  useEffect(() => {
    if (resolvedStatus !== "running" || !startedAt) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, resolvedStatus]);

  const status = getBlockStatusMeta(steps, resolvedStatus);
  const StatusIcon = status.icon;
  const isRunning = resolvedStatus === "running";
  const elapsedMs = startedAt != null ? Math.max(0, (finishedAt ?? now) - startedAt) : undefined;
  const title = getBlockTitle({
    status: resolvedStatus,
    duration: duration ?? (elapsedMs != null ? formatAgentActivityDuration(elapsedMs) : undefined),
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-2.5 py-1 text-left text-app-13 text-subtle transition hover:text-muted"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition ${expanded ? "rotate-90" : ""}`}
        />
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${status.className} ${isRunning ? "animate-spin" : ""}`}
        />
        <span className={`min-w-0 flex-1 truncate font-medium ${status.className}`}>{title}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-3 border-l border-border pl-5">
          {items.map((item) => (
            <ActivityItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
