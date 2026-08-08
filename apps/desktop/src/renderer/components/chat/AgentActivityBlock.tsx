import { CheckCircle2, ChevronRight, CircleDashed, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import type { KimiToolTimelineStatus } from "../../../shared/chat";
import type { MessagePart } from "../../../shared/threadContent";

export type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
export type ShellPart = Extract<MessagePart, { type: "shell" }>;
export type CommentaryPart = {
  type: "commentary";
  id: string;
  content: string;
};
export type KimiThinkingItem = {
  type: "kimi-thinking";
  id: string;
  content: string;
  status: "running" | "completed" | "cancelled";
};
export type KimiToolItem = {
  type: "kimi-tool";
  id: string;
  title: string;
  kind: string;
  command: string;
  filePath: string;
  input: string;
  output: string;
  error: string;
  status: KimiToolTimelineStatus;
};
export type AgentActivityStep = ReasoningPart | ShellPart | KimiThinkingItem | KimiToolItem;
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

const RUNNING_PHRASES = [
  "Model is thinking…",
  "Model is working…",
  "Thinking…",
  "Working…",
  "Processing…",
  "Pondering…",
  "Crunching…",
  "Cooking…",
];

const RUNNING_PHRASE_INTERVAL_MS = 3500;

function pickRunningPhrase(exclude?: string) {
  const candidates = exclude
    ? RUNNING_PHRASES.filter((phrase) => phrase !== exclude)
    : RUNNING_PHRASES;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

function useRunningPhrase(enabled: boolean) {
  const [phrase, setPhrase] = useState(() => pickRunningPhrase());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = window.setInterval(
      () => setPhrase((current) => pickRunningPhrase(current)),
      RUNNING_PHRASE_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [enabled]);

  return phrase;
}

function capitalize(value: string) {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

export function inferAgentActivityStatus(steps: AgentActivityStep[]): AgentActivityStatus {
  if (
    steps.some(
      (step) =>
        (step.type === "shell" && step.status === "failed") ||
        (step.type === "kimi-tool" && step.status === "failed"),
    )
  ) {
    return "failed";
  }

  if (
    steps.some(
      (step) =>
        step.status === "running" || (step.type === "kimi-tool" && step.status === "pending"),
    )
  ) {
    return "running";
  }

  if (steps.some((step) => step.status === "cancelled")) {
    return "cancelled";
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
  if (step.status === "running" || (step.type === "kimi-tool" && step.status === "pending")) {
    return { icon: CircleDashed, className: "text-muted" };
  }

  if (step.status === "cancelled") {
    return { icon: XCircle, className: "text-muted" };
  }

  if (
    (step.type === "shell" && step.status === "failed") ||
    (step.type === "kimi-tool" && step.status === "failed")
  ) {
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
      label: "Processing",
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

function KimiThinkingItemView({ item }: { item: KimiThinkingItem }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getStepStatusMeta(item);
  const StatusIcon = meta.icon;
  const isRunning = item.status === "running";

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-2.5 text-left text-app-12 leading-5 text-muted"
        aria-expanded={expanded}
      >
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${meta.className} ${isRunning ? "animate-spin" : ""}`}
        />
        <span>{isRunning ? "Thinking" : "Thought"}</span>
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-subtle transition group-hover:text-muted ${
            expanded ? "rotate-90" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </button>
      {expanded ? (
        <pre className="mt-2 whitespace-pre-wrap break-words pl-7 text-app-12 leading-5 text-muted">
          {item.content}
        </pre>
      ) : null}
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
          className={`min-w-0 whitespace-pre-wrap break-words font-mono text-app-12 leading-5 text-muted ${expanded ? "" : "line-clamp-1"}`}
        >
          <span className="text-muted">$ </span>
          {step.command}
        </pre>
        {canExpand && (
          <ChevronRight
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle transition group-hover:text-muted ${
              expanded ? "rotate-90" : "opacity-0 group-hover:opacity-100"
            }`}
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

// Mirrors the adapter's describeToolActivity so the timeline shows a readable
// label (e.g. "Read src/a.ts", "Search", "Bash") instead of every tool's raw
// title. Falls back to the title when the kind is unrecognized.
function describeKimiToolActivity(tool: KimiToolItem) {
  const normalizedKind = tool.kind.toLowerCase();
  const target = tool.filePath ? ` ${tool.filePath}` : "";

  if (normalizedKind === "execute") {
    return tool.command || tool.title || "Run command";
  }

  if (normalizedKind === "read") {
    return `Read${target}`;
  }

  if (normalizedKind === "search") {
    return `Search${target}`;
  }

  if (["edit", "write", "delete", "move"].includes(normalizedKind)) {
    return `${capitalize(normalizedKind)}${target}`;
  }

  return `${tool.title}${target}`;
}

// Web search / fetch tools (ACP kind "fetch", or titles like "WebSearch" /
// "FetchURL") get the animated searching orb while running.
function isWebSearchTool(item: KimiToolItem) {
  const haystack = `${item.title} ${item.kind}`.toLowerCase();
  return (
    haystack.includes("fetch") || haystack.includes("websearch") || haystack.includes("web search")
  );
}

function KimiToolItemView({ item }: { item: KimiToolItem }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getStepStatusMeta(item);
  const StatusIcon = meta.icon;
  const isRunning = item.status === "running" || item.status === "pending";
  const label = describeKimiToolActivity(item);
  const hasShellCommand = item.kind.toLowerCase() === "execute" && !!item.command;
  const hasDetail = !!item.output || !!item.error || !!item.input;
  const canExpand = hasShellCommand || hasDetail;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        className={`group flex w-full items-start gap-2.5 text-left ${canExpand ? "cursor-pointer" : "cursor-default"}`}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {isRunning && isWebSearchTool(item) ? (
          <ThinkingOrb state="searching" size={20} className="shrink-0" />
        ) : (
          <StatusIcon
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.className} ${isRunning ? "animate-spin" : ""}`}
          />
        )}
        {hasShellCommand ? (
          <pre
            className={`min-w-0 whitespace-pre-wrap break-words font-mono text-app-12 leading-5 text-muted ${expanded ? "" : "line-clamp-1"}`}
          >
            <span className="text-muted">$ </span>
            {item.command}
          </pre>
        ) : (
          <span className="min-w-0 text-app-12 leading-5 text-muted">{label}</span>
        )}
        {canExpand && (
          <ChevronRight
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle transition group-hover:text-muted ${
              expanded ? "rotate-90" : "opacity-0 group-hover:opacity-100"
            }`}
          />
        )}
      </button>
      {expanded && (
        <div className="space-y-2 pl-6">
          {item.input ? (
            <div className="space-y-1">
              <div className="text-app-11 font-medium text-subtle">Input</div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-code-bg p-3 font-mono text-app-12 leading-relaxed text-muted">
                {item.input}
              </pre>
            </div>
          ) : null}
          {item.error ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-code-bg p-3 font-mono text-app-12 leading-relaxed text-danger">
              {item.error}
            </pre>
          ) : null}
          {item.output ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-code-bg p-3 font-mono text-app-12 leading-relaxed text-muted">
              {item.output}
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
  if (item.type === "kimi-thinking") {
    return <KimiThinkingItemView item={item} />;
  }
  if (item.type === "kimi-tool") {
    return <KimiToolItemView item={item} />;
  }
  return <ShellStepItem step={item} />;
}

export function AgentActivityList({
  items,
  className = "",
}: {
  items: AgentActivityItem[];
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {items.map((item) => (
        <ActivityItem key={item.id} item={item} />
      ))}
    </div>
  );
}

export function AgentActivityBlock({
  items,
  status: explicitStatus,
  startedAt,
  finishedAt,
  duration,
  hasFinalAnswerStarted = false,
  collapsible = true,
}: {
  items: AgentActivityItem[];
  status?: AgentActivityStatus;
  startedAt?: number;
  finishedAt?: number;
  duration?: string;
  hasFinalAnswerStarted?: boolean;
  collapsible?: boolean;
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
  const isCompleted = resolvedStatus === "completed";
  const runningPhrase = useRunningPhrase(isRunning);
  const elapsedMs = startedAt != null ? Math.max(0, (finishedAt ?? now) - startedAt) : undefined;
  const durationLabel =
    duration ?? (elapsedMs != null ? formatAgentActivityDuration(elapsedMs) : undefined);
  const title = getBlockTitle({
    status: resolvedStatus,
    duration: durationLabel,
  });
  const displayTitle = isCompleted
    ? `${status.label}${durationLabel ? ` ${durationLabel}` : ""}`
    : title;
  const headerClassName = `group flex w-full items-center text-left text-app-13 leading-5 text-subtle transition hover:text-muted ${
    isRunning
      ? "gap-2 border-b border-border pb-2 pt-1"
      : isCompleted
        ? "gap-2 border-b border-border pb-2 pt-1"
        : "gap-2.5 py-1"
  }`;
  const headerContent = isRunning ? (
    <>
      <ThinkingOrb state="shaping" size={20} className="shrink-0" />
      <span className="shimmer-text min-w-0 flex-1 truncate font-medium">{runningPhrase}</span>
      {durationLabel ? <span className="shrink-0 text-subtle">{durationLabel}</span> : null}
    </>
  ) : (
    <>
      {collapsible ? (
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition ${expanded ? "rotate-90" : ""}`}
        />
      ) : null}
      {!isCompleted && <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${status.className}`} />}
      <span
        className={`${!isCompleted ? "flex-1" : ""} min-w-0 truncate font-medium ${status.className}`}
      >
        {displayTitle}
      </span>
    </>
  );

  return (
    <div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={headerClassName}
          aria-expanded={expanded}
        >
          {headerContent}
        </button>
      ) : (
        <div className={headerClassName}>{headerContent}</div>
      )}
      {expanded && items.length > 0 && (
        <AgentActivityList
          items={items}
          className={`mt-2 ${collapsible ? "border-l border-border pl-5" : ""}`}
        />
      )}
    </div>
  );
}
