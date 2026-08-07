import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Minus,
  Plus,
  Search,
  SquareCode,
} from "lucide-react";
import type {
  BrowserMenuAction,
  BrowserMenuOverlayState,
  BrowserSearchEngine,
} from "../../../shared/browser";

function MenuIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-3 rounded-md px-2 text-left text-app-13 text-fg hover:bg-surface-hover"
    >
      <span className="flex h-4 w-4 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {trailing}
    </button>
  );
}

export function BrowserMenuContent({
  state,
  onAction,
}: {
  state: BrowserMenuOverlayState;
  onAction: (action: BrowserMenuAction) => void;
}) {
  return (
    <div className="h-full w-full rounded-md border border-border bg-surface-raised p-1.5 shadow-xl">
      {state.mode === "main" ? (
        <>
          <MenuItem
            icon={<Search className="h-4 w-4" />}
            label="Find in page"
            onClick={() => onAction({ type: "find" })}
          />
          <div className="my-1 flex h-10 items-center gap-2 border-y border-border px-2">
            <span className="min-w-0 flex-1 text-app-13">Zoom</span>
            <MenuIconButton
              label="Zoom out"
              onClick={() => onAction({ type: "zoom", action: "out" })}
            >
              <Minus className="h-3.5 w-3.5" />
            </MenuIconButton>
            <button
              type="button"
              onClick={() => onAction({ type: "zoom", action: "reset" })}
              className="w-12 text-center text-app-12 text-muted hover:text-fg"
            >
              {Math.round(state.zoomFactor * 100)}%
            </button>
            <MenuIconButton
              label="Zoom in"
              onClick={() => onAction({ type: "zoom", action: "in" })}
            >
              <Plus className="h-3.5 w-3.5" />
            </MenuIconButton>
          </div>
          <MenuItem
            icon={<Copy className="h-4 w-4" />}
            label="Copy current link"
            onClick={() => onAction({ type: "copy-link" })}
          />
          <MenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            label="Open in system browser"
            onClick={() => onAction({ type: "open-external" })}
          />
          <MenuItem
            icon={<SquareCode className="h-4 w-4" />}
            label="Developer tools"
            onClick={() => onAction({ type: "devtools" })}
          />
          <MenuItem
            label="Clear browsing data"
            trailing={<ChevronRight className="h-4 w-4 text-subtle" />}
            onClick={() => onAction({ type: "set-mode", mode: "data" })}
          />
          <MenuItem
            label="Browser settings"
            trailing={<ChevronRight className="h-4 w-4 text-subtle" />}
            onClick={() => onAction({ type: "set-mode", mode: "settings" })}
          />
        </>
      ) : null}
      {state.mode === "data" ? (
        <>
          <MenuItem
            icon={<ArrowLeft className="h-4 w-4" />}
            label="Clear browsing data"
            onClick={() => onAction({ type: "set-mode", mode: "main" })}
          />
          <div className="my-1 border-t border-border" />
          <MenuItem
            label="Clear current project data"
            onClick={() => onAction({ type: "clear-data", scope: "project" })}
          />
          <MenuItem
            label="Clear all browsing data"
            onClick={() => onAction({ type: "clear-data", scope: "all" })}
          />
        </>
      ) : null}
      {state.mode === "settings" ? (
        <>
          <MenuItem
            icon={<ArrowLeft className="h-4 w-4" />}
            label="Search engine"
            onClick={() => onAction({ type: "set-mode", mode: "main" })}
          />
          <div className="my-1 border-t border-border" />
          {(["google", "bing", "duckduckgo"] as const).map((engine) => (
            <MenuItem
              key={engine}
              label={engine === "duckduckgo" ? "DuckDuckGo" : capitalize(engine)}
              icon={state.searchEngine === engine ? <Check className="h-4 w-4" /> : undefined}
              onClick={() => onAction({ type: "set-search-engine", searchEngine: engine })}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function capitalize(value: BrowserSearchEngine) {
  return value[0].toUpperCase() + value.slice(1);
}
