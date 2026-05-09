import { useState, useMemo, useEffect } from "react";
import { RefreshCw, Power, PowerOff, Plug, Monitor, ChevronRight } from "lucide-react";
import { useRuntimes } from "../hooks/useRuntimes";
import { useWorkspace } from "../context/WorkspaceContext";
import { RuntimeIcon } from "../components/RuntimeIcon";
import { getDetectedRuntimes } from "../lib/runtimeSelection";

function RuntimeListSkeleton() {
  return (
    <div className="space-y-1 px-3 py-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
          <div className="h-4 w-4 shrink-0 rounded bg-surface-raised" />
          <div className="h-8 w-8 shrink-0 rounded-lg bg-surface-raised" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-24 rounded bg-surface-raised" />
            <div className="h-2.5 w-16 rounded bg-surface-raised" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RuntimesPage() {
  const { runtimes, loading, actionStateById, runModelPing, setRuntimeEnabled, refreshVersion } =
    useRuntimes();
  const { setActiveThreadId } = useWorkspace();

  useEffect(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sortedRuntimes = useMemo(() => {
    return getDetectedRuntimes(runtimes).sort((a, b) => a.name.localeCompare(b.name));
  }, [runtimes]);

  useEffect(() => {
    if (selectedId && sortedRuntimes.some((runtime) => runtime.id === selectedId)) {
      return;
    }

    setSelectedId(sortedRuntimes[0]?.id ?? null);
  }, [selectedId, sortedRuntimes]);

  const selectedRuntime = sortedRuntimes.find((r) => r.id === selectedId);

  const getActionState = (id: string) => actionStateById[id] ?? "idle";

  const isActionPending = (id: string) => {
    return getActionState(id) !== "idle";
  };

  const enabledCount = sortedRuntimes.filter((r) => r.enabled).length;

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Top status bar */}
      <div className="drag-region flex items-center gap-3 border-b border-border px-5 py-2.5">
        <div className={`h-2 w-2 rounded-full ${enabledCount > 0 ? "bg-success" : "bg-muted"}`} />
        <span className="text-xs text-muted">
          {enabledCount > 0 ? `${enabledCount} enabled` : "No enabled runtimes"}
        </span>
        <span className="text-xs text-subtle">/</span>
        <span className="text-xs text-subtle">{sortedRuntimes.length} detected</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: runtime list */}
        <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-bg">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Runtimes</h2>
            <span className="text-[11px] text-subtle">
              {enabledCount}/{sortedRuntimes.length}
            </span>
          </div>

          <div className="flex-1 overflow-auto px-2 pb-2">
            {loading && sortedRuntimes.length === 0 ? (
              <RuntimeListSkeleton />
            ) : sortedRuntimes.length > 0 ? (
              sortedRuntimes.map((runtime) => {
                const isActive = runtime.id === selectedId;

                return (
                  <div key={runtime.id}>
                    <div
                      className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition ${
                        isActive ? "bg-surface" : "hover:bg-surface/60"
                      }`}
                    >
                      <div
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
                        onClick={() => setSelectedId(runtime.id)}
                      >
                        <div className="relative">
                          <RuntimeIcon name={runtime.name} size="sm" />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${
                              runtime.enabled ? "bg-success" : "bg-subtle"
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-fg">
                            {runtime.name}
                          </div>
                          <div className="mt-0.5">
                            <span className="text-[11px] text-muted">
                              {runtime.enabled ? "Ready" : "Disabled"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 transition ${
                          isActive ? "text-fg" : "text-subtle"
                        }`}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center text-xs text-subtle">
                No supported CLI detected
              </div>
            )}
          </div>
        </div>

        {/* Right: detail area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          {selectedRuntime ? (
            <div className="mx-auto w-full max-w-xl px-10 py-10">
              {/* Header */}
              <div className="flex items-center gap-4">
                <RuntimeIcon name={selectedRuntime.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold tracking-tight text-fg">
                    {selectedRuntime.name}
                  </h3>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                    <span className="text-success">Detected</span>
                    <span className="text-subtle">·</span>
                    <span className={selectedRuntime.enabled ? "text-success" : "text-subtle"}>
                      {selectedRuntime.enabled ? "Ready" : "Disabled"}
                    </span>
                    <span className="text-subtle">·</span>
                    <span>
                      {selectedRuntime.id === "claude-code"
                        ? "Anthropic"
                        : selectedRuntime.id === "codex"
                          ? "OpenAI"
                          : selectedRuntime.id}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {selectedRuntime.enabled ? (
                    <button
                      onClick={() => setRuntimeEnabled(selectedRuntime.id, false)}
                      disabled={isActionPending(selectedRuntime.id)}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted transition hover:bg-surface hover:text-fg disabled:opacity-50"
                    >
                      <PowerOff className="h-3.5 w-3.5" />
                      Disable
                    </button>
                  ) : (
                    <button
                      onClick={() => setRuntimeEnabled(selectedRuntime.id, true)}
                      disabled={isActionPending(selectedRuntime.id)}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted transition hover:bg-surface hover:text-fg disabled:opacity-50"
                    >
                      <Power className="h-3.5 w-3.5" />
                      Enable
                    </button>
                  )}
                  <button
                    onClick={() => runModelPing(selectedRuntime.id)}
                    disabled={isActionPending(selectedRuntime.id)}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted transition hover:bg-surface hover:text-fg disabled:opacity-50"
                  >
                    {getActionState(selectedRuntime.id) === "model-ping" ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Testing…
                      </>
                    ) : (
                      <>
                        <Plug className="h-3.5 w-3.5" />
                        Test Connection
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Info rows */}
              <div className="mt-10 space-y-5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-xs text-muted">Version</span>
                  <div className="flex items-center gap-2">
                    {getActionState(selectedRuntime.id) === "refreshing-version" ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Refreshing…
                      </span>
                    ) : (
                      <span className="text-sm text-fg">
                        {selectedRuntime.version ?? "Unknown"}
                      </span>
                    )}
                    <button
                      onClick={() => refreshVersion(selectedRuntime.id)}
                      disabled={isActionPending(selectedRuntime.id)}
                      className="text-subtle transition hover:text-muted disabled:opacity-50"
                      title="Refresh version"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          getActionState(selectedRuntime.id) === "refreshing-version"
                            ? "animate-spin"
                            : ""
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-xs text-muted">Last checked</span>
                  <span className="text-sm text-fg">
                    {selectedRuntime.lastCheckedAt
                      ? new Date(selectedRuntime.lastCheckedAt).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-10 border-t border-border pt-6">
                {/* Verification result */}
                {selectedRuntime.verification !== "never" && (
                  <div className="mt-4 text-xs">
                    {selectedRuntime.verification === "passed" && (
                      <span className="text-success">
                        Passed
                        {selectedRuntime.lastVerifiedAt
                          ? ` · ${new Date(selectedRuntime.lastVerifiedAt).toLocaleString()}`
                          : ""}
                      </span>
                    )}
                    {selectedRuntime.verification === "failed" && (
                      <span className="text-danger">
                        Failed
                        {selectedRuntime.lastVerifiedAt
                          ? ` · ${new Date(selectedRuntime.lastVerifiedAt).toLocaleString()}`
                          : ""}
                      </span>
                    )}
                    {selectedRuntime.verification === "unsupported" && (
                      <span className="text-warning">Unsupported</span>
                    )}
                  </div>
                )}
              </div>

              {/* Error */}
              {selectedRuntime.lastError && (
                <div className="mt-6 border-t border-border pt-6">
                  <p className="text-xs text-danger">Last error</p>
                  <p className="mt-2 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-danger/70">
                    {selectedRuntime.lastError}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-subtle">
              <Monitor className="h-5 w-5" />
              <p className="text-sm">Select a runtime to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
