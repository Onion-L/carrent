import { useState, useCallback, useMemo } from "react";
import { Plug, GripVertical, RefreshCw } from "lucide-react";
import { useRuntimes } from "../hooks/useRuntimes";
import { OpenAIIcon } from "../components/icons/OpenAIIcon";
import { ClaudeIcon } from "../components/icons/ClaudeIcon";

const RUNTIME_ORDER_KEY = "carrent:runtimeOrder";

function RuntimeIcon({ name }: { name: string }) {
  const key = name.toLowerCase();
  if (key.includes("codex") || key.includes("openai")) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2a2a2a] text-white">
        <OpenAIIcon className="h-5 w-5" />
      </div>
    );
  }
  if (key.includes("claude")) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2a2a2a]">
        <ClaudeIcon className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2a2a2a] text-[14px] font-bold text-[#ddd]">
      {name.charAt(0).toUpperCase()}
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
  const { runtimes, loading, actionStateById, runModelPing, stop, refreshVersion } = useRuntimes();
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

  const isRefreshingVersion =
    selectedRuntime != null && getActionState(selectedRuntime.id) === "refreshing-version";

  return (
    <div className="flex h-full w-full flex-col bg-[#181818]">
      {/* Top status bar */}
      <div className="drag-region flex items-center gap-3 border-b border-[#252525] px-6 py-3">
        <div
          className={`h-2 w-2 rounded-full ${
            sortedRuntimes.some((r) => r.status === "running")
              ? "bg-emerald-500"
              : "bg-[#555]"
          }`}
        />
        <span className="text-[13px] text-[#999]">
          {sortedRuntimes.some((r) => r.status === "running") ? "Running" : "Stopped"}
        </span>
        {sortedRuntimes.length > 0 && (
          <span className="text-[13px] text-[#666]">
            · {sortedRuntimes.map((r) => r.name).join(", ")}
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: runtime list */}
        <div className="flex h-full w-[280px] flex-col border-r border-[#252525] bg-[#181818]">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <h2 className="text-[13px] font-semibold text-[#ddd]">Runtimes</h2>
            <span className="text-[12px] text-[#666]">
              {sortedRuntimes.filter((r) => r.availability === "detected").length}/
              {sortedRuntimes.length} online
            </span>
          </div>

          <div className="flex-1 overflow-auto">
            {loading && sortedRuntimes.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-[#555]">
                Detecting...
              </div>
            ) : (
              sortedRuntimes.map((runtime, index) => {
                const isActive = runtime.id === selectedId;
                const isOnline = runtime.availability === "detected";
                const isDragging = draggedId === runtime.id;
                const isDragOver = dragOverId === runtime.id;
                return (
                  <div key={runtime.id}>
                    <div
                      draggable
                      onDragStart={() => handleDragStart(runtime.id)}
                      onDragOver={(e) => handleDragOver(e, runtime.id)}
                      onDrop={() => handleDrop(runtime.id)}
                      onDragEnd={handleDragEnd}
                      className={`flex w-full cursor-move items-center gap-2 border-b border-[#252525] px-3 py-3 text-left transition ${
                        isActive ? "bg-[#252525]" : "hover:bg-[#1e1e1e]"
                      } ${isDragging ? "opacity-40" : "opacity-100"} ${
                        isDragOver && draggedId !== runtime.id
                          ? "border-t-2 border-t-[#444] bg-[#1c1c1c]"
                          : ""
                      }`}
                    >
                      <GripVertical className="h-4 w-4 shrink-0 text-[#444]" />
                      <div
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                        onClick={() => setSelectedId(runtime.id)}
                      >
                        <RuntimeIcon name={runtime.name} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium text-[#ddd]">
                            {runtime.name}
                          </div>
                          <div className="mt-0.5 text-[12px] text-[#888]">
                            {runtime.status === "running" ? "Running" : "Stopped"}
                          </div>
                        </div>
                      </div>

                      <div
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          isOnline ? "bg-emerald-500" : "bg-[#444]"
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
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedRuntime ? (
            <div className="flex flex-1 flex-col">
              {/* Detail header */}
              <div className="flex items-center justify-between border-b border-[#252525] px-6 py-4">
                <div className="flex items-center gap-3">
                  <RuntimeIcon name={selectedRuntime.name} />
                  <div>
                    <h3 className="text-[16px] font-semibold text-[#ddd]">
                      {selectedRuntime.name}
                    </h3>
                    <div className="mt-0.5 flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          selectedRuntime.status === "running"
                            ? "bg-emerald-500"
                            : "bg-[#555]"
                        }`}
                      />
                      <span className="text-[12px] text-[#999]">
                        {selectedRuntime.status === "running"
                          ? "Running"
                          : "Stopped"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {selectedRuntime.status === "running" && (
                    <button
                      onClick={() => stop(selectedRuntime.id)}
                      disabled={isActionPending(selectedRuntime.id)}
                      className="text-[13px] text-[#888] transition hover:text-[#ccc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Stop
                    </button>
                  )}
                  <button
                    onClick={() => runModelPing(selectedRuntime.id)}
                    disabled={isActionPending(selectedRuntime.id)}
                    className="flex items-center gap-2 rounded-lg border border-[#2f2f2f] bg-[#252525] px-3 py-1.5 text-[13px] text-[#ccc] transition hover:bg-[#2f2f2f] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plug className="h-3.5 w-3.5" />
                    Test Connection
                  </button>
                </div>
              </div>

              {/* Detail info */}
              <div className="flex-1 px-6 py-5">
                <div className="space-y-4">
                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
                      Status
                    </div>
                    <div className="mt-1 text-[14px] text-[#ccc]">
                      {selectedRuntime.status === "running"
                        ? "Running"
                        : "Stopped"}
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
                      Last restarted
                    </div>
                    <div className="mt-1 text-[14px] text-[#ccc]">
                      {selectedRuntime.lastRestartedAt
                        ? new Date(
                            selectedRuntime.lastRestartedAt,
                          ).toLocaleString()
                        : "Never"}
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
                      Provider
                    </div>
                    <div className="mt-1 text-[14px] text-[#ccc]">
                      {selectedRuntime.id === "claude-code"
                        ? "Anthropic"
                        : selectedRuntime.id === "codex"
                          ? "OpenAI"
                          : selectedRuntime.id}
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
                      Version
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[14px] text-[#ccc]">
                      <span
                        className={isRefreshingVersion ? "animate-pulse text-[#999]" : undefined}
                        aria-live="polite"
                      >
                        {selectedRuntime.version ?? "Unknown"}
                      </span>
                      <button
                        onClick={() => refreshVersion(selectedRuntime.id)}
                        disabled={isActionPending(selectedRuntime.id)}
                        className={`flex items-center rounded p-1 text-[#666] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          isRefreshingVersion ? "bg-[#2f2f2f] text-[#999]" : "hover:bg-[#2f2f2f] hover:text-[#999]"
                        }`}
                        title={isRefreshingVersion ? "Refreshing version" : "Refresh version"}
                        aria-label={isRefreshingVersion ? "Refreshing version" : "Refresh version"}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingVersion ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
                      Last Seen
                    </div>
                    <div className="mt-1 text-[14px] text-[#ccc]">
                      {selectedRuntime.lastCheckedAt
                        ? new Date(
                            selectedRuntime.lastCheckedAt,
                          ).toLocaleString()
                        : "Never"}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-[#555]">
              <p className="text-[15px]">Select a runtime to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
