import { useState, useCallback, useMemo } from "react";
import {
  Plug,
  GripVertical,
  RefreshCw,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FolderOpen,
  Terminal,
  Clock,
  RotateCcw,
} from "lucide-react";
import { useRuntimes } from "../hooks/useRuntimes";
import { OpenAIIcon } from "../components/icons/OpenAIIcon";
import { ClaudeIcon } from "../components/icons/ClaudeIcon";
import type {
  RuntimeAvailability,
  RuntimeStatus,
  RuntimeConfigState,
  RuntimeVerificationState,
} from "../../shared/runtimes";

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

function StatusBadge({
  status,
}: {
  status: RuntimeAvailability | RuntimeStatus | RuntimeConfigState | RuntimeVerificationState;
}) {
  const configs: Record<
    string,
    { label: string; icon: React.ReactNode; className: string }
  > = {
    detected: {
      label: "Detected",
      icon: <CheckCircle2 className="h-3 w-3" />,
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    unavailable: {
      label: "Unavailable",
      icon: <XCircle className="h-3 w-3" />,
      className: "bg-red-500/10 text-red-400 border-red-500/20",
    },
    running: {
      label: "Running",
      icon: <Activity className="h-3 w-3" />,
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    stopped: {
      label: "Stopped",
      icon: <XCircle className="h-3 w-3" />,
      className: "bg-[#333] text-[#888] border-[#333]",
    },
    configured: {
      label: "Configured",
      icon: <CheckCircle2 className="h-3 w-3" />,
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    missing: {
      label: "Missing",
      icon: <AlertTriangle className="h-3 w-3" />,
      className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
    unknown: {
      label: "Unknown",
      icon: <HelpCircle className="h-3 w-3" />,
      className: "bg-[#333] text-[#888] border-[#333]",
    },
    passed: {
      label: "Passed",
      icon: <CheckCircle2 className="h-3 w-3" />,
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    failed: {
      label: "Failed",
      icon: <XCircle className="h-3 w-3" />,
      className: "bg-red-500/10 text-red-400 border-red-500/20",
    },
    never: {
      label: "Never",
      icon: <HelpCircle className="h-3 w-3" />,
      className: "bg-[#333] text-[#888] border-[#333]",
    },
    unsupported: {
      label: "Unsupported",
      icon: <AlertTriangle className="h-3 w-3" />,
      className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
  };

  const config = configs[status] ?? {
    label: status,
    icon: <HelpCircle className="h-3 w-3" />,
    className: "bg-[#333] text-[#888] border-[#333]",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

function InfoRow({
  label,
  value,
  icon,
  action,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-2 text-[13px] text-[#666]">
        {icon && <span className="text-[#555]">{icon}</span>}
        {label}
      </div>
      <div className="flex items-center gap-2 text-[13px] text-[#ccc]">
        <span className="truncate text-right">{value}</span>
        {action}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#252525] bg-[#1c1c1c]">
      <div className="flex items-center gap-2 border-b border-[#252525] px-4 py-3">
        {icon && <span className="text-[#555]">{icon}</span>}
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[#666]">
          {title}
        </h4>
      </div>
      <div className="px-4">{children}</div>
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
    stop,
    refreshVersion,
  } = useRuntimes();
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
    selectedRuntime != null &&
    getActionState(selectedRuntime.id) === "refreshing-version";

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
          {sortedRuntimes.some((r) => r.status === "running")
            ? "Running"
            : "Stopped"}
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
              {sortedRuntimes.filter((r) => r.availability === "detected").length}
              /{sortedRuntimes.length} online
            </span>
          </div>

          <div className="flex-1 overflow-auto">
            {loading && sortedRuntimes.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-[#555]">
                Detecting...
              </div>
            ) : (
              sortedRuntimes.map((runtime) => {
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
                          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#888]">
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full ${
                                isOnline ? "bg-emerald-500" : "bg-[#444]"
                              }`}
                            />
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
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          {selectedRuntime ? (
            <div className="flex flex-col">
              {/* Detail header */}
              <div className="flex items-center justify-between border-b border-[#252525] px-8 py-5">
                <div className="flex items-center gap-4">
                  <RuntimeIcon name={selectedRuntime.name} />
                  <div>
                    <h3 className="text-[18px] font-semibold text-[#ddd]">
                      {selectedRuntime.name}
                    </h3>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusBadge status={selectedRuntime.status} />
                      <StatusBadge status={selectedRuntime.availability} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {selectedRuntime.status === "running" && (
                    <button
                      onClick={() => stop(selectedRuntime.id)}
                      disabled={isActionPending(selectedRuntime.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-[#2f2f2f] bg-transparent px-3 py-1.5 text-[13px] text-[#888] transition hover:border-[#444] hover:text-[#ccc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
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

              {/* Detail content */}
              <div className="flex flex-1 flex-col gap-5 p-8">
                {/* Status cards */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div className="rounded-xl border border-[#252525] bg-[#1c1c1c] p-4">
                    <div className="text-[12px] text-[#666]">Status</div>
                    <div className="mt-2">
                      <StatusBadge status={selectedRuntime.status} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#252525] bg-[#1c1c1c] p-4">
                    <div className="text-[12px] text-[#666]">Availability</div>
                    <div className="mt-2">
                      <StatusBadge status={selectedRuntime.availability} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#252525] bg-[#1c1c1c] p-4">
                    <div className="text-[12px] text-[#666]">Configuration</div>
                    <div className="mt-2">
                      <StatusBadge status={selectedRuntime.configuration} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#252525] bg-[#1c1c1c] p-4">
                    <div className="text-[12px] text-[#666]">Verification</div>
                    <div className="mt-2">
                      <StatusBadge status={selectedRuntime.verification} />
                    </div>
                  </div>
                </div>

                {/* Configuration */}
                <SectionCard title="Configuration" icon={<Terminal className="h-3.5 w-3.5" />}>
                  <InfoRow
                    label="Provider"
                    value={
                      selectedRuntime.id === "claude-code"
                        ? "Anthropic"
                        : selectedRuntime.id === "codex"
                          ? "OpenAI"
                          : selectedRuntime.id
                    }
                  />
                  <div className="border-t border-[#252525]">
                    <InfoRow
                      label="Version"
                      icon={<RotateCcw className="h-3.5 w-3.5" />}
                      value={
                        isRefreshingVersion ? (
                          <span className="inline-flex items-center gap-1.5 text-[#888]">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            Refreshing…
                          </span>
                        ) : (
                          selectedRuntime.version ?? "Unknown"
                        )
                      }
                      action={
                        <button
                          onClick={() => refreshVersion(selectedRuntime.id)}
                          disabled={isActionPending(selectedRuntime.id)}
                          className={`flex items-center rounded p-1 text-[#666] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            isRefreshingVersion
                              ? "bg-[#2f2f2f] text-[#999]"
                              : "hover:bg-[#2f2f2f] hover:text-[#999]"
                          }`}
                          title={
                            isRefreshingVersion ? "Refreshing version" : "Refresh version"
                          }
                          aria-label={
                            isRefreshingVersion ? "Refreshing version" : "Refresh version"
                          }
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${isRefreshingVersion ? "animate-spin" : ""}`}
                          />
                        </button>
                      }
                    />
                  </div>
                  <div className="border-t border-[#252525]">
                    <InfoRow
                      label="Command"
                      icon={<Terminal className="h-3.5 w-3.5" />}
                      value={
                        <code className="rounded bg-[#252525] px-1.5 py-0.5 font-mono text-[12px] text-[#aaa]">
                          {selectedRuntime.command}
                        </code>
                      }
                    />
                  </div>
                  <div className="border-t border-[#252525]">
                    <InfoRow
                      label="Path"
                      icon={<FolderOpen className="h-3.5 w-3.5" />}
                      value={
                        selectedRuntime.path ? (
                          <code className="max-w-[320px] truncate rounded bg-[#252525] px-1.5 py-0.5 font-mono text-[12px] text-[#aaa]">
                            {selectedRuntime.path}
                          </code>
                        ) : (
                          "—"
                        )
                      }
                    />
                  </div>
                  <div className="border-t border-[#252525]">
                    <InfoRow
                      label="Model Ping"
                      value={selectedRuntime.supportsModelPing ? "Supported" : "Not supported"}
                    />
                  </div>
                </SectionCard>

                {/* Activity */}
                <SectionCard title="Activity" icon={<Clock className="h-3.5 w-3.5" />}>
                  <InfoRow
                    label="Last checked"
                    value={
                      selectedRuntime.lastCheckedAt
                        ? new Date(selectedRuntime.lastCheckedAt).toLocaleString()
                        : "Never"
                    }
                  />
                  <div className="border-t border-[#252525]">
                    <InfoRow
                      label="Last restarted"
                      value={
                        selectedRuntime.lastRestartedAt
                          ? new Date(selectedRuntime.lastRestartedAt).toLocaleString()
                          : "Never"
                      }
                    />
                  </div>
                  {selectedRuntime.pid != null && (
                    <div className="border-t border-[#252525]">
                      <InfoRow
                        label="PID"
                        value={
                          <code className="rounded bg-[#252525] px-1.5 py-0.5 font-mono text-[12px] text-[#aaa]">
                            {selectedRuntime.pid}
                          </code>
                        }
                      />
                    </div>
                  )}
                </SectionCard>

                {/* Error */}
                {selectedRuntime.lastError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-red-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Last Error
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-red-300/80">
                      {selectedRuntime.lastError}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-[#555]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#222]">
                <Terminal className="h-6 w-6 text-[#444]" />
              </div>
              <p className="mt-4 text-[15px]">Select a runtime to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
