import { Bot, FileDiff, Globe2, SquareTerminal } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import type { RightSurface } from "./useRightSurface";

type SurfaceAvailability = {
  browser: boolean;
  terminal: boolean;
  changes: boolean;
  inspector: boolean;
};

// Matches --panel-duration in styles/index.css. After a collapse finishes the
// retained content is dropped; until then the pane keeps sweeping over it.
const COLLAPSE_DURATION_MS = 200;
const PANE_WIDTH_STORAGE_KEY = "carrent:right-surface-pane-width";

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

function readStoredPaneWidth(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PANE_WIDTH_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function RightSurfacePane({
  activeSurface,
  availability,
  width,
  onWidthChange,
  onSelect,
  children,
}: {
  activeSurface: RightSurface | null;
  availability: SurfaceAvailability;
  width: number | null;
  onWidthChange: (width: number) => void;
  onSelect: (surface: RightSurface) => void;
  children?: (surface: RightSurface, closing: boolean) => ReactNode;
}) {
  // The collapsed shell stays mounted so reopening runs as a width transition.
  // While a collapse plays out, `retainedSurface` keeps the last surface alive
  // so the clip edge sweeps over real content instead of an empty pane.
  const [retainedSurface, setRetainedSurface] = useState<RightSurface | null>(activeSurface);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (activeSurface) {
      setRetainedSurface(activeSurface);
      return;
    }
    if (!retainedSurface) return;
    // Let the collapse finish before dropping the content, then wait for an
    // idle frame: tearing down a heavy surface (native browser view, xterm,
    // diff trees) right on the animation's tail frame reads as a stutter.
    let idleId: number | undefined;
    const drop = () => setRetainedSurface(null);
    const settleId = window.setTimeout(() => {
      idleId =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(drop, { timeout: 500 })
          : undefined;
      if (idleId === undefined) drop();
    }, COLLAPSE_DURATION_MS);
    return () => {
      window.clearTimeout(settleId);
      if (idleId !== undefined && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
    };
  }, [activeSurface, retainedSurface]);

  const shownSurface = activeSurface ?? retainedSurface;
  const isClosing = activeSurface === null && retainedSurface !== null;

  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const minWidth = 352;
  const maxWidth = Math.round(viewportWidth * 0.7);
  const resolvedWidth = Math.max(
    minWidth,
    Math.min(maxWidth, width ?? readStoredPaneWidth() ?? Math.round(viewportWidth * 0.45)),
  );

  const commitWidth = (next: number) => {
    const clamped = Math.max(minWidth, Math.min(maxWidth, next));
    onWidthChange(clamped);
    window.localStorage.setItem(PANE_WIDTH_STORAGE_KEY, String(Math.round(clamped)));
  };

  const resizeBy = (delta: number) => {
    commitWidth(resolvedWidth + delta);
  };

  return (
    <aside
      aria-label="Right panel"
      className={`flex h-full shrink-0 justify-end overflow-hidden ${
        isResizing ? "panel-dragging" : "panel-collapse-x"
      }`}
      style={{ width: activeSurface ? resolvedWidth : 0 }}
    >
      {shownSurface ? (
        <div
          className="relative flex h-full shrink-0 flex-col border-l border-border bg-bg"
          style={{ width: resolvedWidth }}
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
              setIsResizing(true);
              const startX = event.clientX;
              const startWidth =
                event.currentTarget.parentElement?.getBoundingClientRect().width ?? 520;
              const onMove = (moveEvent: MouseEvent) => {
                commitWidth(
                  Math.max(minWidth, Math.min(maxWidth, startWidth + startX - moveEvent.clientX)),
                );
              };
              const onUp = () => {
                setIsResizing(false);
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
            {shownSurface === "chooser" ? (
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
            ) : children ? (
              children(shownSurface, isClosing)
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
