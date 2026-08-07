import { Check, CircleAlert, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { ChatPermissionRequest } from "../../../shared/chatPermissions";

type PlanDecisionPanelProps = {
  permission: ChatPermissionRequest;
  onRespond: (optionId: string) => Promise<boolean>;
  onRequestRevision: (optionId: string, feedback: string) => Promise<boolean>;
};

export function getPlanDecisionOptions(permission: ChatPermissionRequest) {
  const execution = permission.options.filter(
    (option) => option.kind === "allow_once" || option.kind === "allow_always",
  );
  const revise =
    permission.options.find((option) => option.optionId === "plan_revise") ??
    permission.options.find((option) => option.name.trim().toLowerCase() === "revise") ??
    null;
  const exit =
    permission.options.find((option) => option.optionId === "plan_reject_and_exit") ??
    permission.options.find((option) => option.name.trim().toLowerCase() === "reject and exit") ??
    null;

  return { execution, revise, exit };
}

export function PlanDecisionPanel({
  permission,
  onRespond,
  onRequestRevision,
}: PlanDecisionPanelProps) {
  const options = useMemo(() => getPlanDecisionOptions(permission), [permission]);
  const [selectedOptionId, setSelectedOptionId] = useState(
    () => options.execution[0]?.optionId ?? "",
  );
  const [revisionMode, setRevisionMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitDecision = async (optionId: string) => {
    setSubmitting(true);
    setError(null);
    try {
      if (!(await onRespond(optionId))) {
        setError("This plan decision is no longer available.");
      }
    } catch {
      setError("Could not submit the plan decision. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitRevision = async () => {
    const content = feedback.trim();
    if (!options.revise || !content) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (!(await onRequestRevision(options.revise.optionId, content))) {
        setError("This plan decision is no longer available.");
      }
    } catch {
      setError("Could not request a revision. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Plan decision"
      className="rounded-xl border border-border-strong bg-surface-raised/90 p-3 shadow-[0_18px_60px_rgb(0_0_0/0.18)]"
    >
      {revisionMode ? (
        <div className="space-y-3">
          <div>
            <div className="text-app-13 font-medium text-fg">What should change?</div>
            <div className="mt-0.5 text-app-12 leading-5 text-subtle">
              Your feedback will start the next Plan Mode turn.
            </div>
          </div>
          <textarea
            autoFocus
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Describe the changes you want..."
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-app-13 leading-5 text-fg outline-none transition focus:border-border-strong disabled:opacity-50"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setRevisionMode(false);
                setError(null);
              }}
              disabled={submitting}
              className="h-8 rounded-md px-2.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void submitRevision()}
              disabled={submitting || !feedback.trim()}
              className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition hover:opacity-90 disabled:opacity-40"
            >
              <Pencil className="h-3.5 w-3.5" />
              Request revision
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-app-13 font-medium text-fg">Plan ready</div>
            <div className="mt-0.5 text-app-12 leading-5 text-subtle">
              Review the plan above before the Runtime starts implementation.
            </div>
          </div>

          {options.execution.length > 1 ? (
            <div role="radiogroup" aria-label="Plan approach" className="space-y-1">
              {options.execution.map((option) => (
                <label
                  key={option.optionId}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                >
                  <input
                    type="radio"
                    name={`plan-approach-${permission.id}`}
                    value={option.optionId}
                    checked={selectedOptionId === option.optionId}
                    onChange={() => setSelectedOptionId(option.optionId)}
                    disabled={submitting}
                    className="accent-current"
                  />
                  <span>{option.name}</span>
                </label>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {options.exit ? (
              <button
                type="button"
                onClick={() => void submitDecision(options.exit!.optionId)}
                disabled={submitting}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Exit plan mode
              </button>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {options.revise ? (
                <button
                  type="button"
                  onClick={() => {
                    setRevisionMode(true);
                    setError(null);
                  }}
                  disabled={submitting}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Request changes
                </button>
              ) : null}
              {selectedOptionId ? (
                <button
                  type="button"
                  onClick={() => void submitDecision(selectedOptionId)}
                  disabled={submitting}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {options.execution.length > 1 ? "Run approach" : "Approve & run"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {error ? (
        <div role="alert" className="mt-3 flex items-center gap-2 text-app-12 text-danger">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      ) : null}
    </section>
  );
}
