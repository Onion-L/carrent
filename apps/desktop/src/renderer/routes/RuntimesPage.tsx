import { useState } from "react";
import { useRuntimes } from "../hooks/useRuntimes";

const RUNTIME_ICONS: Record<string, string> = {
  hermes: "🐱",
  gemini: "💎",
  claude: "✺",
  codex: "◯",
  opencode: "❐",
  kimi: "K",
};

function getRuntimeIcon(name: string): string {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(RUNTIME_ICONS)) {
    if (key.includes(k)) return v;
  }
  return "◯";
}

function getRuntimeDisplayName(name: string): string {
  // Append a mock device name
  return `${name} (oniondeMacBook-Pro...)`;
}

export function RuntimesPage() {
  const { runtimes, loading } = useRuntimes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedRuntime = runtimes.find((r) => r.id === selectedId);

  return (
    <div className="flex h-full w-full bg-[#181818]">
      {/* Left: runtime list */}
      <div className="flex h-full w-[280px] flex-col border-r border-[#252525] bg-[#181818]">
        <div className="px-4 pb-2 pt-3">
          <h2 className="text-[13px] font-semibold text-[#ddd]">Runtimes</h2>
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
                  {/* Icon */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2a2a2a] text-[18px]">
                    {getRuntimeIcon(runtime.name)}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-[#ddd]">
                      {getRuntimeDisplayName(runtime.name)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#666]">
                      <div className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-[#333] text-[10px]">
                        O
                      </div>
                      <span>onionl5236</span>
                    </div>
                  </div>

                  {/* Status dot */}
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

      {/* Right: content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedRuntime ? (
          <div className="flex flex-1 flex-col items-center justify-center text-[#666]">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#252525] text-[28px]">
              {getRuntimeIcon(selectedRuntime.name)}
            </div>
            <h3 className="mt-4 text-[18px] font-semibold text-[#ddd]">
              {selectedRuntime.name}
            </h3>
            <p className="mt-1 text-[13px] text-[#666]">
              {selectedRuntime.path ?? "No path configured"}
            </p>
            <p className="mt-4 text-[13px] text-[#555]">
              Runtime detail panel placeholder
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-[#555]">
            <p className="text-[15px]">Select a runtime to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
