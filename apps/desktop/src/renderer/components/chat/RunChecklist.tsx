import { useId } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, LoaderCircle } from "lucide-react";

import type {
  RunChecklistEntry,
  RunChecklistItemStatus,
  RunChecklistOutcome,
  ThreadRunChecklist,
} from "../../../shared/runChecklist";

const ITEM_STATUS_LABELS: Record<RunChecklistItemStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
};

const OUTCOME_LABELS: Record<RunChecklistOutcome, string> = {
  running: "Run in progress",
  completed: "Run completed",
  failed: "Run failed",
  cancelled: "Run cancelled",
};

export function getRunChecklistProgress(entries: RunChecklistEntry[]): number {
  const activeIndex = entries.findIndex((entry) => entry.status === "in_progress");
  if (activeIndex >= 0) {
    return activeIndex + 1;
  }
  return entries.filter((entry) => entry.status === "completed").length;
}

function ChecklistStatusIcon({ status }: { status: RunChecklistItemStatus }) {
  if (status === "completed") {
    return <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-success" />;
  }
  if (status === "in_progress") {
    return <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-fg" />;
  }
  return <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-subtle" />;
}

export function RunChecklist({
  checklist,
  onExpandedChange,
}: {
  checklist: ThreadRunChecklist;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const panelId = useId();
  const progress = getRunChecklistProgress(checklist.entries);

  return (
    <section
      aria-label="Run Checklist"
      className="mb-2 overflow-hidden rounded-md border border-border bg-bg/60"
    >
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={checklist.expanded}
        onClick={() => onExpandedChange(!checklist.expanded)}
        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
      >
        <span className="font-medium text-fg">
          Step {progress} of {checklist.entries.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-subtle">
          {OUTCOME_LABELS[checklist.outcome]}
        </span>
        {checklist.expanded ? (
          <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
        )}
      </button>
      {checklist.expanded ? (
        <ul
          id={panelId}
          role="list"
          className="max-h-[min(16rem,35vh)] overflow-y-auto border-t border-border px-3 py-1.5"
        >
          {checklist.entries.map((entry, index) => (
            <li
              key={`${index}:${entry.content}`}
              className={`flex min-h-8 items-start gap-2 py-1.5 text-app-13 leading-5 ${
                entry.status === "completed"
                  ? "text-subtle"
                  : entry.status === "in_progress"
                    ? "font-medium text-fg"
                    : "text-muted"
              }`}
            >
              <ChecklistStatusIcon status={entry.status} />
              <span className="min-w-0 break-words">
                <span className="sr-only">{ITEM_STATUS_LABELS[entry.status]}: </span>
                {entry.content}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
