import { CircleAlert, RotateCcw } from "lucide-react";
import { useState } from "react";

import type { MessagePart } from "../../../shared/threadContent";

export type ErrorPart = Extract<MessagePart, { type: "error" }>;

export function ErrorBlock({
  part,
  onRemoveRuntimeSessionAndRetry,
}: {
  part: ErrorPart;
  onRemoveRuntimeSessionAndRetry?: (part: ErrorPart) => Promise<void> | void;
}) {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    if (!onRemoveRuntimeSessionAndRetry || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRemoveRuntimeSessionAndRetry(part);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-danger/30 bg-danger/5">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <span className="min-w-0 flex-1 text-app-13 text-danger">{part.message}</span>
      </div>
      {part.runtimeSessionRecovery && onRemoveRuntimeSessionAndRetry ? (
        <div className="border-t border-danger/20 px-3 py-2">
          <button
            type="button"
            disabled={isRetrying}
            onClick={() => void handleRetry()}
            className="inline-flex items-center gap-1.5 text-app-12 font-medium text-danger hover:text-fg disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {isRetrying ? "Retrying..." : "Remove Runtime Session and retry"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
