import { Bot, FileDiff, Globe2, LayoutGrid, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTerminalPanel } from "../../context/TerminalPanelContext";

export type RightSurface = "chooser" | "browser" | "terminal" | "changes" | "inspector";

export function useRightSurface({
  scopeKey,
  openBrowser,
}: {
  scopeKey: string | null;
  openBrowser: () => void;
}) {
  const [activeSurface, setActiveSurfaceState] = useState<RightSurface | null>(null);
  const lastSurfaceByScope = useRef(new Map<string, RightSurface>());
  const {
    isOpen: terminalOpen,
    placement: terminalPlacement,
    openTerminal,
    closeTerminal,
    setSideContainer,
  } = useTerminalPanel();

  useEffect(() => {
    setActiveSurfaceState(null);
    if (terminalOpen && terminalPlacement === "side") closeTerminal();
  }, [scopeKey]);

  useEffect(() => {
    if (activeSurface === "terminal" && (!terminalOpen || terminalPlacement !== "side")) {
      setActiveSurfaceState("chooser");
    }
  }, [activeSurface, terminalOpen, terminalPlacement]);

  const selectSurface = useCallback(
    (surface: RightSurface) => {
      setActiveSurfaceState(surface);
      if (scopeKey && surface !== null && surface !== "chooser") {
        lastSurfaceByScope.current.set(scopeKey, surface);
      }
      if (surface !== "terminal" && terminalOpen && terminalPlacement === "side") closeTerminal();
      if (surface === "browser") openBrowser();
      if (surface === "terminal") openTerminal("side");
    },
    [closeTerminal, openBrowser, openTerminal, scopeKey, terminalOpen, terminalPlacement],
  );

  const openRightSurface = () => {
    selectSurface(scopeKey ? (lastSurfaceByScope.current.get(scopeKey) ?? "chooser") : "chooser");
  };

  const closeRightSurface = () => {
    if (terminalOpen && terminalPlacement === "side") closeTerminal();
    setActiveSurfaceState(null);
  };

  return {
    activeSurface,
    selectSurface,
    openRightSurface,
    closeRightSurface,
    setSideContainer,
  };
}

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
    label: "Environment & agents",
    description: "Inspect the project and agent activity",
    icon: Bot,
  },
] as const;

export function RightSurfacePane({
  activeSurface,
  availability,
  width,
  onWidthChange,
  onSelect,
  onClose,
  children,
}: {
  activeSurface: RightSurface;
  availability: SurfaceAvailability;
  width: number | null;
  onWidthChange: (width: number) => void;
  onSelect: (surface: RightSurface) => void;
  onClose: () => void;
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
      className="relative flex h-full min-w-[22rem] max-w-[70%] shrink-0 flex-col border-l border-border bg-bg"
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

      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border bg-sidebar px-2">
        <button
          type="button"
          aria-label="Choose panel"
          title="Choose panel"
          aria-pressed={activeSurface === "chooser"}
          onClick={() => onSelect("chooser")}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 ${
            activeSurface === "chooser" ? "bg-surface-raised text-fg" : "text-subtle hover:text-fg"
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
        {SURFACES.map((surface) => {
          const Icon = surface.icon;
          const available = availability[surface.id];
          return (
            <button
              key={surface.id}
              type="button"
              aria-label={surface.label}
              title={available ? surface.label : `${surface.label} unavailable`}
              aria-pressed={activeSurface === surface.id}
              disabled={!available}
              onClick={() => onSelect(surface.id)}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:opacity-30 ${
                activeSurface === surface.id
                  ? "bg-surface-raised text-fg"
                  : "text-subtle hover:text-fg"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Close right panel"
          title="Close right panel"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeSurface === "chooser" ? (
          <div className="flex h-full items-center justify-center px-6 py-8">
            <div className="w-full max-w-[25rem]">
              <div className="mb-4 px-2">
                <h2 className="text-app-15 font-medium text-fg">Open a panel</h2>
                <p className="mt-1 text-app-12 text-subtle">Choose what to work with here.</p>
              </div>
              <div className="space-y-1">
                {SURFACES.map((surface) => {
                  const Icon = surface.icon;
                  const available = availability[surface.id];
                  return (
                    <button
                      key={surface.id}
                      type="button"
                      disabled={!available}
                      onClick={() => onSelect(surface.id)}
                      className="group flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted group-hover:text-fg">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-app-13 font-medium text-fg">
                          {surface.label}
                        </span>
                        <span className="block truncate text-app-12 text-subtle">
                          {surface.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </aside>
  );
}
