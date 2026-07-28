import { useState } from "react";
import { AlertTriangle, Copy, RefreshCw, Trash2, X } from "lucide-react";

import { useAppState } from "../context/AppStateContext";

export function AppStateRecoveryPage() {
  const { recoveryDiagnostics, rereadAppState, fullResetAppState } = useAppState();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState<"reread" | "reset" | null>(null);

  const reread = async () => {
    setBusy("reread");
    await rereadAppState();
    setBusy(null);
  };

  const reset = async () => {
    setBusy("reset");
    const recovered = await fullResetAppState();
    if (!recovered) {
      setBusy(null);
      setConfirmingReset(false);
    }
  };

  const copyDiagnostics = () =>
    window.carrent.clipboard.writeText(JSON.stringify(recoveryDiagnostics ?? [], null, 2));

  return (
    <main className="flex h-full min-h-screen w-full items-center justify-center bg-bg px-6 py-10 text-fg">
      <section className="w-full max-w-xl">
        <AlertTriangle aria-hidden="true" className="mb-5 h-8 w-8 text-danger" />
        <h1 className="text-app-22 font-semibold">Carrent data could not be loaded</h1>
        <p className="mt-3 text-app-14 leading-6 text-muted">
          App State is blocked to prevent partial data from being displayed or changed.
        </p>
        <div className="mt-6 border-l-2 border-border pl-4 text-app-12 text-subtle">
          <p>{recoveryDiagnostics?.at(-1)?.summary ?? "App State validation failed."}</p>
          <p className="mt-1 break-all">{recoveryDiagnostics?.at(-1)?.dataPath}</p>
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-app-13 font-medium text-white disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void reread()}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {busy === "reread" ? "Re-reading..." : "Re-read"}
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-app-13 font-medium hover:bg-surface-hover"
            onClick={() => void copyDiagnostics()}
            type="button"
          >
            <Copy aria-hidden="true" className="h-4 w-4" />
            Copy diagnostics
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-danger/50 px-3 text-app-13 font-medium text-danger hover:bg-danger/10"
            disabled={busy !== null}
            onClick={() => setConfirmingReset(true)}
            type="button"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Full reset
          </button>
        </div>
      </section>

      {confirmingReset ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <section
            aria-labelledby="full-reset-title"
            aria-modal="true"
            className="w-full max-w-md rounded-md border border-border bg-surface-raised p-5 shadow-xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-app-16 font-semibold" id="full-reset-title">
                  Permanently reset Carrent data?
                </h2>
                <p className="mt-3 text-app-13 leading-5 text-muted">
                  This deletes Carrent App State, Runtime Session mappings, attachments, and legacy
                  projectless chat data.
                </p>
                <p className="mt-3 text-app-13 leading-5 text-muted">
                  Project Working Directories, project files, and Git state are not changed.
                </p>
              </div>
              <button
                aria-label="Cancel full reset"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-surface-hover"
                onClick={() => setConfirmingReset(false)}
                type="button"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border px-3 text-app-13 font-medium hover:bg-surface-hover"
                onClick={() => setConfirmingReset(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-md bg-danger px-3 text-app-13 font-medium text-white disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void reset()}
                type="button"
              >
                {busy === "reset" ? "Resetting..." : "Permanently reset Carrent data"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
