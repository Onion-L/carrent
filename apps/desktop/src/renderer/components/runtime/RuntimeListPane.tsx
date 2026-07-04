import { ChevronRight } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { RuntimeIcon } from "../RuntimeIcon";
import { useRuntimes } from "../../hooks/useRuntimes";

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

export function RuntimeListPane() {
  const { runtimes, loading } = useRuntimes();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("runtime");

  const sortedRuntimes = useMemo(() => {
    return [...runtimes].sort((a, b) => a.name.localeCompare(b.name));
  }, [runtimes]);

  const enabledCount = sortedRuntimes.filter((runtime) => runtime.enabled).length;

  useEffect(() => {
    if (selectedId && sortedRuntimes.some((runtime) => runtime.id === selectedId)) {
      return;
    }

    const firstRuntimeId = sortedRuntimes[0]?.id;
    if (!firstRuntimeId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("runtime", firstRuntimeId);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, selectedId, setSearchParams, sortedRuntimes]);

  const selectRuntime = (runtimeId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("runtime", runtimeId);
    setSearchParams(nextParams);
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Runtimes</h2>
        <span className="text-[11px] text-subtle">
          {enabledCount}/{sortedRuntimes.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {loading && sortedRuntimes.length === 0 ? (
          <RuntimeListSkeleton />
        ) : sortedRuntimes.length > 0 ? (
          <div className="space-y-0.5">
            {sortedRuntimes.map((runtime) => {
              const isActive = runtime.id === selectedId;

              return (
                <button
                  key={runtime.id}
                  onClick={() => selectRuntime(runtime.id)}
                  className={`group flex min-h-14 w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition ${
                    isActive
                      ? "bg-surface-hover text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong)/0.32)]"
                      : "text-muted hover:bg-surface-raised hover:text-fg"
                  }`}
                >
                  <div className="relative shrink-0">
                    <RuntimeIcon name={runtime.name} size="sm" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${
                        runtime.availability === "detected" && runtime.enabled
                          ? "bg-success"
                          : "bg-subtle"
                      }`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{runtime.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {runtime.availability === "detected"
                        ? runtime.enabled
                          ? "Ready"
                          : "Disabled"
                        : "Unavailable"}
                    </div>
                  </div>

                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 transition ${
                      isActive ? "text-fg" : "text-subtle"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-xs text-subtle">No supported CLI detected</div>
        )}
      </div>
    </aside>
  );
}
