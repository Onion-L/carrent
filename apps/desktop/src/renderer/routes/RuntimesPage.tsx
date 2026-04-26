import { useState, useCallback, useMemo, useEffect } from "react";
import {
  GripVertical,
  RefreshCw,
  Square,
  Play,
  Plug,
  Monitor,
  ChevronRight,
} from "lucide-react";
import { useRuntimes } from "../hooks/useRuntimes";
import { useWorkspace } from "../context/WorkspaceContext";
import { RuntimeIcon } from "../components/RuntimeIcon";

const RUNTIME_ORDER_KEY = "carrent:runtimeOrder";

function RuntimeListSkeleton() {
  return (
    <div className="space-y-1 px-3 py-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
          <div className="h-4 w-4 shrink-0 rounded bg-[#252525]" />
          <div className="h-8 w-8 shrink-0 rounded-lg bg-[#252525]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-24 rounded bg-[#252525]" />
            <div className="h-2.5 w-16 rounded bg-[#252525]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function readStoredOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(RUNTIME_ORDER_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore
  }
  return null;
}

function writeStoredOrder(order: string[]) {
  try {
    localStorage.setItem(RUNTIME_ORDER_KEY, JSON.stringify(order));
  } catch {
    // ignore
  }
}

export function RuntimesPage() {
  const {
    runtimes,
    loading,
    actionStateById,
    runModelPing,
    start,
    stop,
    refreshVersion,
  } = useRuntimes();
  const { setActiveThreadId } = useWorkspace();

  useEffect(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orderedIds, setOrderedIds] = useState<string[]>(() => {
    const stored = readStoredOrder();
    if (stored) return stored;
    return runtimes.map((r) => r.id);
  });
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sortedRuntimes = useMemo(() => {
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
    return [...runtimes].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [runtimes, orderedIds]);

  const selectedRuntime = sortedRuntimes.find((r) => r.id === selectedId);

  const getActionState = (id: string) => actionStateById[id] ?? "idle";

  const isActionPending = (id: string) => {
    return getActionState(id) !== "idle";
  };

  const handleDragStart = useCallback((id: string) => {
    setDraggedId(id);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault();
      if (id !== draggedId) {
        setDragOverId(id);
      }
    },
    [draggedId],
  );

  const handleDrop = useCallback(
    (targetId: string) => {
      if (!draggedId || draggedId === targetId) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      setOrderedIds((prev) => {
        const next = prev.filter((id) => id !== draggedId);
        const targetIndex = next.indexOf(targetId);
        if (targetIndex >= 0) {
          next.splice(targetIndex, 0, draggedId);
        } else {
          next.push(draggedId);
        }
        writeStoredOrder(next);
        return next;
      });
      setDraggedId(null);
      setDragOverId(null);
    },
    [draggedId],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  const onlineCount = sortedRuntimes.filter((r) => r.availability === "detected").length;

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Top status bar */}
      <div className="drag-region flex items-center gap-3 border-b border-border px-5 py-2.5">
        <div className={`h-2 w-2 rounded-full ${onlineCount > 0 ? "bg-success" : "bg-muted"}`} />
        <span className="text-xs text-muted">
          {onlineCount > 0 ? `${onlineCount} online` : "All offline"}
        </span>
        <span className="text-xs text-[#555]">/</span>
        <span className="text-xs text-[#555]">{sortedRuntimes.length} runtimes</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: runtime list */}
        <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-bg">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Runtimes</h2>
            <span className="text-[11px] text-[#555]">
              {onlineCount}/{sortedRuntimes.length}
            </span>
          </div>

          <div className="flex-1 overflow-auto px-2 pb-2">
            {loading && sortedRuntimes.length === 0 ? (
              <RuntimeListSkeleton />
            ) : (
              sortedRuntimes.map((runtime) => {
                const isActive = runtime.id === selectedId;
                const isOnline = runtime.availability === "detected";
                const isDragging = draggedId === runtime.id;
                const isDragOver = dragOverId === runtime.id;
                const isRunning = runtime.status === "running";

                return (
                  <div key={runtime.id}>
                    <div
                      draggable
                      onDragStart={() => handleDragStart(runtime.id)}
                      onDragOver={(e) => handleDragOver(e, runtime.id)}
                      onDrop={() => handleDrop(runtime.id)}
                      onDragEnd={handleDragEnd}
                      className={`group flex w-full cursor-move items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition ${
                        isActive ? "bg-surface" : "hover:bg-surface/60"
                      } ${isDragging ? "opacity-40" : "opacity-100"} ${
                        isDragOver && draggedId !== runtime.id
                          ? "ring-1 ring-inset ring-[#444]"
                          : ""
                      }`}
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-[#444] opacity-0 transition group-hover:opacity-100" />
                      <div
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
                        onClick={() => setSelectedId(runtime.id)}
                      >
                        <div className="relative">
                          <RuntimeIcon name={runtime.name} size="sm" />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${
                              isOnline ? "bg-success" : "bg-[#444]"
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-fg">
                            {runtime.name}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span
                              className={`inline-block h-1 w-1 rounded-full ${
                                isRunning ? "bg-success" : "bg-[#555]"
                              }`}
                            />
                            <span className="text-[11px] text-muted">
                              {isRunning ? "Running" : "Stopped"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 transition ${
                          isActive ? "text-fg" : "text-[#444]"
                        }`}
                      />
                    </div>
                  </div>
                );
              })
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
                    <span
                      className={
                        selectedRuntime.availability === "detected"
                          ? "text-success"
                          : "text-[#555]"
                      }
                    >
                      {selectedRuntime.availability === "detected" ? "Online" : "Offline"}
                    </span>
                    <span className="text-[#333]">·</span>
                    <span
                      className={
                        selectedRuntime.status === "running" ? "text-success" : "text-[#555]"
                      }
                    >
                      {selectedRuntime.status === "running" ? "Running" : "Stopped"}
                    </span>
                    <span className="text-[#333]">·</span>
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
                  {selectedRuntime.status === "running" ? (
                    <button
                      onClick={() => stop(selectedRuntime.id)}
                      disabled={isActionPending(selectedRuntime.id)}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted transition hover:bg-surface hover:text-fg disabled:opacity-50"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => start(selectedRuntime.id)}
                      disabled={isActionPending(selectedRuntime.id)}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted transition hover:bg-surface hover:text-fg disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Start
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
                      className="text-[#444] transition hover:text-muted disabled:opacity-50"
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

                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-xs text-muted">Last restarted</span>
                  <span className="text-sm text-fg">
                    {selectedRuntime.lastRestartedAt
                      ? new Date(selectedRuntime.lastRestartedAt).toLocaleString()
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
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[#444]">
              <Monitor className="h-5 w-5" />
              <p className="text-sm">Select a runtime to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
