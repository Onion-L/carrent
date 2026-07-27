import { useEffect, useState } from "react";
import { Card } from "@carrent/ui";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleDot,
  FileDiff,
  GitBranch,
  Laptop,
  Loader2,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import { useThreadContentDiff } from "../../context/WorkspaceDiffContext";
import type { ChangedFilesMessage, Message, SubagentTaskPart } from "../../../shared/threadContent";
import { MarkdownContent } from "./MarkdownContent";

export function collectSubagentTasks(messages: Message[]): SubagentTaskPart[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || message.type === "changed_files" || !message.parts) {
      return [];
    }

    return message.parts.filter((part): part is SubagentTaskPart => part.type === "subagent_task");
  });
}

export function sortSubagentTasks(tasks: SubagentTaskPart[]): {
  active: SubagentTaskPart[];
  settled: SubagentTaskPart[];
} {
  const active = tasks
    .filter((task) => task.status === "running")
    .sort((a, b) => b.startedAt - a.startedAt);
  const settled = tasks
    .filter((task) => task.status !== "running")
    .sort((a, b) => b.startedAt - a.startedAt);
  return { active, settled };
}

export function selectLatestChangedFilesMessage(messages: Message[]): ChangedFilesMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === "changed_files" && Array.isArray(message.changedFiles)) {
      return message;
    }
  }

  return null;
}

export function getChangedFilesTotals(message: ChangedFilesMessage | null): {
  fileCount: number;
  additions: number;
  deletions: number;
} {
  const files = message?.changedFiles ?? [];
  return {
    fileCount: files.filter((file) => !file.isFolder).length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

export function formatSubagentTaskDuration(task: SubagentTaskPart, now = Date.now()): string {
  const end = task.finishedAt ?? now;
  const totalSeconds = Math.max(0, Math.round((end - task.startedAt) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

export function updateSeenSubagentTasks(input: {
  tasks: SubagentTaskPart[];
  seenTaskIds: ReadonlySet<string>;
}): { seenTaskIds: Set<string>; shouldOpen: boolean } {
  const seenTaskIds = new Set(input.seenTaskIds);
  let shouldOpen = false;
  for (const task of input.tasks) {
    if (seenTaskIds.has(task.id)) {
      continue;
    }

    seenTaskIds.add(task.id);
    if (task.status === "running") {
      shouldOpen = true;
    }
  }

  return { seenTaskIds, shouldOpen };
}

export function shouldShowInspectorToggle(input: {
  hasProjectEnvironment: boolean;
  taskCount: number;
}): boolean {
  return input.hasProjectEnvironment || input.taskCount > 0;
}

export function resolveRightPane(input: {
  diffOpen: boolean;
  inspectorOpen: boolean;
}): "diff" | "inspector" | null {
  if (input.diffOpen) {
    return "diff";
  }

  return input.inspectorOpen ? "inspector" : null;
}

const SUBAGENT_STATUS_LABEL: Record<SubagentTaskPart["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  detached: "Detached",
};

export const THREAD_INSPECTOR_TITLE = "Subagents";

// The inspector is a floating card anchored below the titlebar; it overlays
// the timeline instead of taking layout space.
const INSPECTOR_CARD_CLASS =
  "flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-[0_12px_40px_rgb(0_0_0/0.18)]";

export function ThreadInspectorToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle thread tools card"
      aria-pressed={open}
      title="Environment and subagents"
      className={`relative flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 ${
        open ? "text-fg" : "text-muted hover:text-fg"
      }`}
    >
      <SlidersHorizontal className="h-4 w-4" />
    </button>
  );
}

function SubagentStatusIcon({ status }: { status: SubagentTaskPart["status"] }) {
  const className =
    status === "completed"
      ? "h-3.5 w-3.5 shrink-0 text-success"
      : status === "failed"
        ? "h-3.5 w-3.5 shrink-0 text-danger"
        : "h-3.5 w-3.5 shrink-0 text-muted";

  if (status === "completed") {
    return <CheckCircle2 className={className} />;
  }
  if (status === "failed") {
    return <XCircle className={className} />;
  }
  if (status === "interrupted") {
    return <AlertCircle className={className} />;
  }
  if (status === "detached") {
    return <CircleDot className={className} />;
  }
  return <Loader2 className={className} />;
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-app-12 text-subtle">{label}</span>
      <span className="min-w-0 truncate text-app-12 text-fg">{value}</span>
    </div>
  );
}

function SubagentTaskRow({
  task,
  onSelect,
}: {
  task: SubagentTaskPart;
  onSelect: (taskId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      aria-label={`${SUBAGENT_STATUS_LABEL[task.status]}: ${task.description}`}
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
    >
      <SubagentStatusIcon status={task.status} />
      <span className="min-w-0 flex-1 truncate text-app-13 text-fg">{task.description}</span>
      {task.agentType && (
        <span className="max-w-20 shrink-0 truncate text-app-12 text-subtle">{task.agentType}</span>
      )}
      <span className="shrink-0 text-app-12 text-subtle">{formatSubagentTaskDuration(task)}</span>
    </button>
  );
}

function SubagentTaskDetail({ task, onBack }: { task: SubagentTaskPart; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to subagents"
          title="Back"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-app-15 font-semibold text-fg">
          {task.description}
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MetadataRow label="Status" value={SUBAGENT_STATUS_LABEL[task.status]} />
        {task.agentType && <MetadataRow label="Agent type" value={task.agentType} />}
        {task.runtimeAgentId && <MetadataRow label="Runtime agent" value={task.runtimeAgentId} />}
        <MetadataRow label="Duration" value={formatSubagentTaskDuration(task)} />

        {task.prompt && (
          <section className="mt-4">
            <h3 className="text-app-12 font-medium tracking-wide text-muted">PROMPT</h3>
            <div className="mt-1 max-h-64 overflow-y-auto">
              <p className="whitespace-pre-wrap break-words text-app-13 text-fg">{task.prompt}</p>
            </div>
          </section>
        )}

        {task.summary && (
          <section className="mt-4">
            <h3 className="text-app-12 font-medium tracking-wide text-muted">RESULT</h3>
            <div className="mt-1 max-h-64 overflow-y-auto text-app-13">
              <MarkdownContent>{task.summary}</MarkdownContent>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export function ThreadInspectorContent({
  messages,
  projectPath,
  branch,
  selectedTaskId,
  onSelectTask,
  onOpenDiff,
}: {
  messages: Message[];
  projectPath?: string;
  branch: string | null;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
  onOpenDiff?: (message: ChangedFilesMessage) => void;
}) {
  const tasks = collectSubagentTasks(messages);
  const { active, settled } = sortSubagentTasks(tasks);
  const selectedTask = selectedTaskId
    ? (tasks.find((task) => task.id === selectedTaskId) ?? null)
    : null;

  if (selectedTask) {
    return (
      <div className={INSPECTOR_CARD_CLASS} role="complementary" aria-label="Thread inspector">
        <SubagentTaskDetail task={selectedTask} onBack={() => onSelectTask(null)} />
      </div>
    );
  }

  const latestChanges = projectPath ? selectLatestChangedFilesMessage(messages) : null;
  const totals = getChangedFilesTotals(latestChanges);
  const canOpenDiff = !!latestChanges?.snapshot && !!onOpenDiff;

  return (
    <div className={INSPECTOR_CARD_CLASS} role="complementary" aria-label="Thread inspector">
      {projectPath && (
        <section className="shrink-0 px-3 pb-1 pt-3">
          <h2 className="mb-2 px-1 text-app-13 font-medium text-muted">Environment</h2>
          <Card className="space-y-0.5 p-1.5">
            {canOpenDiff ? (
              <button
                type="button"
                onClick={() => onOpenDiff(latestChanges!)}
                className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
              >
                <FileDiff className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 text-app-13 text-fg">Changes</span>
                <span className="flex shrink-0 items-center gap-2 text-app-13">
                  <span className="text-fg">
                    {totals.fileCount} file{totals.fileCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-success">+{totals.additions}</span>
                  <span className="text-danger">-{totals.deletions}</span>
                </span>
              </button>
            ) : (
              <div
                className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-1.5"
                aria-disabled="true"
              >
                <FileDiff className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 text-app-13 text-fg">Changes</span>
                <span className="flex shrink-0 items-center gap-2 text-app-13">
                  <span className="text-fg">
                    {totals.fileCount} file{totals.fileCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-success">+{totals.additions}</span>
                  <span className="text-danger">-{totals.deletions}</span>
                </span>
              </div>
            )}
            <div className="flex h-9 items-center gap-2 px-1.5">
              <Laptop className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 text-app-13 text-fg">Local</span>
            </div>
            <div className="flex h-9 items-center gap-2 px-1.5">
              <GitBranch className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-app-13 text-fg">{branch ?? "—"}</span>
            </div>
          </Card>
        </section>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col ${projectPath ? "border-t border-border" : ""}`}
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-muted" />
            <h2 className="truncate text-app-13 font-medium text-fg">{THREAD_INSPECTOR_TITLE}</h2>
            {tasks.length > 0 && (
              <span className="shrink-0 text-app-12 text-subtle">
                {active.length} active · {settled.length} settled
              </span>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {tasks.length === 0 ? (
            <p className="px-2 py-1 text-app-13 text-subtle">No subagents</p>
          ) : (
            <>
              {active.length > 0 && (
                <section>
                  <h3 className="px-2 pb-1 text-app-12 text-subtle">Running</h3>
                  {active.map((task) => (
                    <SubagentTaskRow key={task.id} task={task} onSelect={onSelectTask} />
                  ))}
                </section>
              )}
              {settled.length > 0 && (
                <section className={active.length > 0 ? "mt-3" : undefined}>
                  <h3 className="px-2 pb-1 text-app-12 text-subtle">Recent</h3>
                  {settled.map((task) => (
                    <SubagentTaskRow key={task.id} task={task} onSelect={onSelectTask} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThreadInspectorPane({
  messages,
  projectPath,
  selectedTaskId,
  onSelectTask,
}: {
  messages: Message[];
  projectPath?: string;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
}) {
  const [branch, setBranch] = useState<string | null>(null);
  const { openDiff } = useThreadContentDiff();

  useEffect(() => {
    if (!projectPath) {
      setBranch(null);
      return;
    }

    let cancelled = false;
    setBranch(null);
    window.carrent.git
      .branches(projectPath)
      .then((info) => {
        if (!cancelled) {
          setBranch(typeof info?.current === "string" ? info.current : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranch(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return (
    <ThreadInspectorContent
      messages={messages}
      projectPath={projectPath}
      branch={branch}
      selectedTaskId={selectedTaskId}
      onSelectTask={onSelectTask}
      onOpenDiff={(message) => {
        if (message.snapshot) {
          openDiff(message.snapshot, message.changedFiles);
        }
      }}
    />
  );
}
