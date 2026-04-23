import { useState } from "react";
import { useRuntimes } from "../hooks/useRuntimes";
import { OpenAIIcon } from "../components/icons/OpenAIIcon";
import { ClaudeIcon } from "../components/icons/ClaudeIcon";

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

export function RuntimesPage() {
  const { runtimes, loading, actionStateById, runModelPing } = useRuntimes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedRuntime = runtimes.find((r) => r.id === selectedId);

  const isActionPending = (id: string) => {
    const state = actionStateById[id];
    return state && state !== "idle";
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#181818]">
      {/* Top status bar */}
      <div className="flex items-center gap-3 border-b border-[#252525] px-6 py-3">
        <div
          className={`h-2 w-2 rounded-full ${
            runtimes.some((r) => r.status === "running")
              ? "bg-emerald-500"
              : "bg-[#555]"
          }`}
        />
        <span className="text-[13px] text-[#999]">
          {runtimes.some((r) => r.status === "running") ? "Running" : "Stopped"}
        </span>
        {runtimes.length > 0 && (
          <span className="text-[13px] text-[#666]">
            · {runtimes.map((r) => r.name).join(", ")}
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: runtime list */}
      <div className="flex h-full w-[280px] flex-col border-r border-[#252525] bg-[#181818]">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-[13px] font-semibold text-[#ddd]">Runtimes</h2>
          <span className="text-[12px] text-[#666]">
            {runtimes.filter((r) => r.availability === "detected").length}/
            {runtimes.length} online
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          {loading && runtimes.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[#555]">
              Detecting...
            </div>
          ) : (
            runtimes.map((runtime) => {
              const isActive = runtime.id === selectedId;
              const isOnline = runtime.availability === "detected";
              return (
                <button
                  key={runtime.id}
                  onClick={() => setSelectedId(runtime.id)}
                  className={`flex w-full items-center gap-3 border-b border-[#252525] px-4 py-3 text-left transition ${
                    isActive ? "bg-[#252525]" : "hover:bg-[#1e1e1e]"
                  }`}
                >
                  <RuntimeIcon name={runtime.name} />

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-[#ddd]">
                      {runtime.name}
                    </div>
                    {runtime.path && (
                      <div className="truncate text-[12px] text-[#666]">
                        {runtime.path}
                      </div>
                    )}
                  </div>

                  <div
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      isOnline ? "bg-emerald-500" : "bg-[#444]"
                    }`}
                  />
                </button>
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
              <button
                onClick={() => runModelPing(selectedRuntime.id)}
                disabled={isActionPending(selectedRuntime.id)}
                className="flex items-center gap-2 rounded-lg border border-[#2f2f2f] bg-[#252525] px-3 py-1.5 text-[13px] text-[#ccc] transition hover:bg-[#2f2f2f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Test Connection
              </button>
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

                {selectedRuntime.status === "running" && (
                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
                      CLI
                    </div>
                    <div className="mt-1 rounded-lg bg-[#1e1e1e] px-3 py-2 font-mono text-[13px] text-[#aaa]">
                      {selectedRuntime.command}
                    </div>
                  </div>
                )}

                {selectedRuntime.path && (
                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
                      Path
                    </div>
                    <div className="mt-1 text-[14px] text-[#888]">
                      {selectedRuntime.path}
                    </div>
                  </div>
                )}
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
