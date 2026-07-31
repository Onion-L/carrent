import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Search, SquareTerminal } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThreadHistoryPane } from "./chat/ThreadHistoryPane";
import { SettingsTabsPane } from "./settings/SettingsTabsPane";
import { McpServerControl } from "./mcp/McpServerControl";
import { DesktopHeaderActionsSlot } from "./DesktopHeaderActions";
import { WorkspaceNavigationPane } from "./workspace/WorkspaceNavigationPane";
import { WorkspaceRail } from "./workspace/WorkspaceRail";
import { useAppState } from "../context/AppStateContext";
import { ThreadSearchDialog } from "./workspace/ThreadSearchDialog";
import { WorkspaceSwitcher } from "./workspace/WorkspaceSwitcher";
import { buildThreadPath } from "../lib/navigation";
import { IntegratedTerminal } from "./terminal/IntegratedTerminal";

const LEFT_SIDEBAR_WIDTH = 58;
const MIN_SECONDARY_PANE_WIDTH = 200;
const MAX_SECONDARY_PANE_WIDTH = 480;
const DEFAULT_SECONDARY_PANE_WIDTH = 280;

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [isSecondaryPaneCollapsed, setIsSecondaryPaneCollapsed] = useState(false);
  const [secondaryPaneWidth, setSecondaryPaneWidth] = useState(DEFAULT_SECONDARY_PANE_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ x: 0, width: DEFAULT_SECONDARY_PANE_WIDTH });
  const location = useLocation();
  const {
    workspaces,
    projects,
    associations,
    threads,
    activeWorkspaceId,
    projectDirectoryStatusById,
    selectWorkspace,
  } = useAppState();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const [isThreadSearchOpen, setIsThreadSearchOpen] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const projectRoute = location.pathname.match(/^\/workspace\/[^/]+\/project\/([^/]+)(?:\/|$)/u);
  const currentProject = projectRoute
    ? (projects.find((project) => project.id === decodeURIComponent(projectRoute[1])) ?? null)
    : null;
  const canOpenTerminal =
    currentProject != null && projectDirectoryStatusById[currentProject.id] === "available";
  const secondaryPane =
    location.pathname === "/settings" ? (
      <SettingsTabsPane />
    ) : location.pathname.startsWith("/workspace/") ? (
      <WorkspaceNavigationPane />
    ) : (
      <ThreadHistoryPane />
    );

  const toggleSecondaryPane = useCallback(() => {
    setIsSecondaryPaneCollapsed((collapsed) => !collapsed);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setIsThreadSearchOpen(true);
      }
      if (event.metaKey && event.key.toLocaleLowerCase() === "j" && canOpenTerminal) {
        event.preventDefault();
        setIsTerminalOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [canOpenTerminal]);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      resizeStartRef.current = { x: event.clientX, width: secondaryPaneWidth };
      setIsResizing(true);
      document.body.style.userSelect = "none";

      const handleMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - resizeStartRef.current.x;
        const nextWidth = Math.max(
          MIN_SECONDARY_PANE_WIDTH,
          Math.min(MAX_SECONDARY_PANE_WIDTH, resizeStartRef.current.width + delta),
        );
        setSecondaryPaneWidth(nextWidth);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [secondaryPaneWidth],
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-bg text-fg">
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-sidebar shadow-[0_0_0_1px_rgb(255_255_255/0.02),0_18px_48px_rgb(0_0_0/0.18)]">
        <header
          className="drag-region flex h-[calc(env(titlebar-area-height,38px)+0.375rem)] shrink-0 items-stretch justify-between bg-sidebar"
          style={{
            paddingLeft: "92px",
            paddingRight: "16px",
          }}
        >
          <div className="no-drag flex h-full items-center gap-1">
            <button
              aria-label={isSecondaryPaneCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={isSecondaryPaneCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSecondaryPane}
              className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:scale-95"
            >
              {isSecondaryPaneCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              aria-label="Search Threads"
              title="Search Threads"
              onClick={() => setIsThreadSearchOpen(true)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:scale-95"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            {activeWorkspace && <WorkspaceSwitcher />}
          </div>

          <div className="no-drag flex h-full items-center gap-1">
            <DesktopHeaderActionsSlot />
            {canOpenTerminal ? (
              <button
                type="button"
                aria-label={
                  isTerminalOpen ? "Hide Integrated Terminal" : "Show Integrated Terminal"
                }
                title={isTerminalOpen ? "Hide Integrated Terminal" : "Show Integrated Terminal"}
                aria-pressed={isTerminalOpen}
                onClick={() => setIsTerminalOpen((open) => !open)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:scale-95"
              >
                <SquareTerminal className="h-4 w-4" />
              </button>
            ) : null}
            <McpServerControl />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-bg">
          <div className="min-h-0 shrink-0" style={{ width: LEFT_SIDEBAR_WIDTH }}>
            <WorkspaceRail />
          </div>

          <div className="min-h-0 min-w-0 flex-1 bg-sidebar pb-1.5 pr-1.5">
            <div className="flex h-full min-h-0">
              <div
                className={`min-h-0 shrink-0 overflow-hidden ${isResizing ? "" : "transition-[width] duration-200 ease-out"}`}
                style={{ width: isSecondaryPaneCollapsed ? 0 : secondaryPaneWidth }}
              >
                {secondaryPane}
              </div>

              {!isSecondaryPaneCollapsed && (
                <div onMouseDown={handleResizeStart} className="w-1 shrink-0 cursor-col-resize" />
              )}

              <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg">
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
                <IntegratedTerminal
                  project={currentProject}
                  isOpen={isTerminalOpen && canOpenTerminal}
                  onOpenChange={setIsTerminalOpen}
                />
              </main>
            </div>
          </div>
        </div>
      </div>
      {isThreadSearchOpen && (
        <ThreadSearchDialog
          threads={threads}
          workspaces={workspaces}
          projects={projects}
          associations={associations}
          onClose={() => setIsThreadSearchOpen(false)}
          onSelect={async (entry) => {
            setIsThreadSearchOpen(false);
            const path = buildThreadPath(
              entry.thread.workspaceId,
              entry.thread.projectId,
              entry.thread.id,
            );
            if (path === location.pathname) return;
            await selectWorkspace(entry.thread.workspaceId);
            navigate(path);
          }}
        />
      )}
    </div>
  );
}
