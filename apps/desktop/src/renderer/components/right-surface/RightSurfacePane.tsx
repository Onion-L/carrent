import { Bot, FileDiff, Globe2, SquareTerminal } from "lucide-react";
import { type ReactNode } from "react";

import type { RightSurface } from "./useRightSurface";

type SurfaceAvailability = {
  browser: boolean;
  terminal: boolean;
  changes: boolean;
  inspector: boolean;
};

export function shouldOpenDiffSurface(diffScopeKey: string | null, currentScopeKey: string | null) {
  return diffScopeKey !== null && diffScopeKey === currentScopeKey;
}

const SURFACES = [
  {
    id: "browser",
    label: "Browser",
    description: "Open a local app or URL",
    icon: Globe2,
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Start a shell in this project",
    icon: SquareTerminal,
  },
  {
    id: "changes",
    label: "Changes",
    description: "Review changes from this thread",
    icon: FileDiff,
  },
  {
    id: "inspector",
    label: "Subagents",
    description: "Review subagent activity in this thread",
    icon: Bot,
  },
] as const;

export function RightSurfacePane({
  activeSurface,
  availability,
  width,
  onWidthChange,
  onSelect,
  children,
}: {
  activeSurface: RightSurface;
  availability: SurfaceAvailability;
  width: number | null;
  onWidthChange: (width: number) => void;
  onSelect: (surface: RightSurface) => void;
  children?: ReactNode;
}) {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const resolvedWidth = width ?? Math.round(viewportWidth * 0.45);
  const minWidth = 352;
  const maxWidth = Math.round(viewportWidth * 0.7);

  const resizeBy = (delta: number) => {
    onWidthChange(Math.max(minWidth, Math.min(maxWidth, resolvedWidth + delta)));
  };

  return (
    <aside
      className="right-pane-enter relative flex h-full min-w-[22rem] max-w-[70%] shrink-0 flex-col border-l border-border bg-bg"
      style={{ width: width ?? "45%" }}
      aria-label="Right panel"
    >
      <div
        role="separator"
        aria-label="Resize right panel"
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={resolvedWidth}
        tabIndex={0}
        className="absolute bottom-0 left-0 top-0 z-30 w-1 -translate-x-1/2 cursor-col-resize hover:bg-border-strong"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const amount = event.shiftKey ? 40 : 10;
          resizeBy(event.key === "ArrowLeft" ? amount : -amount);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth =
            event.currentTarget.parentElement?.getBoundingClientRect().width ?? 520;
          const onMove = (moveEvent: MouseEvent) => {
            onWidthChange(
              Math.max(minWidth, Math.min(maxWidth, startWidth + startX - moveEvent.clientX)),
            );
          };
          const onUp = () => {
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.body.style.userSelect = "none";
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeSurface === "chooser" ? (
          <div className="flex h-full flex-col justify-center gap-4 px-3 py-6">
            <div className="px-2">
              <h2 className="text-app-15 font-semibold text-fg">Open a panel</h2>
              <p className="mt-1 text-app-12 text-subtle">Choose what to work with here.</p>
            </div>
            <div className="flex flex-col gap-2">
              {SURFACES.map((surface) => {
                const Icon = surface.icon;
                const available = availability[surface.id];
                return (
                  <button
                    key={surface.id}
                    type="button"
                    aria-label={surface.label}
                    title={available ? surface.label : `${surface.label} unavailable`}
                    disabled={!available}
                    onClick={() => onSelect(surface.id)}
                    className="group flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted transition group-hover:text-fg">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-app-14 font-medium text-fg">
                        {surface.label}
                      </span>
                      <span className="mt-0.5 block truncate text-app-12 text-subtle">
                        {surface.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </aside>
  );
}
