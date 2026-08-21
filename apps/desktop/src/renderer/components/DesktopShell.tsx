import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Search, SquarePen, SquareTerminal, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThreadHistoryPane } from "./chat/ThreadHistoryPane";
import { SettingsTabsPane } from "./settings/SettingsTabsPane";
import { DesktopHeaderActionsSlot } from "./DesktopHeaderActions";
import { WorkspaceNavigationPane } from "./workspace/WorkspaceNavigationPane";
import { WorkspaceRail } from "./workspace/WorkspaceRail";
import { useAppState } from "../context/AppStateContext";
import { ThreadSearchDialog } from "./workspace/ThreadSearchDialog";
import { WorkspaceSwitcher } from "./workspace/WorkspaceSwitcher";
import { buildProjectPath, buildThreadPath } from "../lib/navigation";
import { IntegratedTerminal } from "./terminal/IntegratedTerminal";
import { WindowZoomControl } from "./WindowZoomControl";
import { TerminalPanelProvider, type TerminalPlacement } from "../context/TerminalPanelContext";
import { useKeybinding } from "../hooks/useKeybinding";
import { useSettings } from "../context/SettingsContext";
import { buildEffectiveKeybindingMap } from "../lib/keybindings";
import { getProjectThreads } from "../lib/projectThreads";

const LEFT_SIDEBAR_WIDTH = 58;
const MIN_SECONDARY_PANE_WIDTH = 200;
const MAX_SECONDARY_PANE_WIDTH = 480;
const DEFAULT_SECONDARY_PANE_WIDTH = 280;
const SECONDARY_PANE_WIDTH_STORAGE_KEY = "carrent:secondary-pane-width";

function readStoredSecondaryPaneWidth() {
  if (typeof window === "undefined") return DEFAULT_SECONDARY_PANE_WIDTH;
  const raw = window.localStorage.getItem(SECONDARY_PANE_WIDTH_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SECONDARY_PANE_WIDTH;
  return Math.min(MAX_SECONDARY_PANE_WIDTH, Math.max(MIN_SECONDARY_PANE_WIDTH, parsed));
}

export function getSecondaryPaneKind(pathname: string) {
  if (pathname === "/settings") return "settings";
  if (pathname === "/" || pathname.startsWith("/workspace/")) return "workspace";
  return "thread-history";
}

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { keybindingOverrides } = useSettings();
  const [isSecondaryPaneCollapsed, setIsSecondaryPaneCollapsed] = useState(false);
  const [secondaryPaneWidth, setSecondaryPaneWidth] = useState(readStoredSecondaryPaneWidth);
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
    openThreadDraft,
    selectWorkspace,
  } = useAppState();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const [isThreadSearchOpen, setIsThreadSearchOpen] = useState(false);
  const [isNewThreadProjectPickerOpen, setIsNewThreadProjectPickerOpen] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalPlacement, setTerminalPlacement] = useState<TerminalPlacement>("bottom");
  const [terminalSideContainer, setTerminalSideContainer] = useState<HTMLElement | null>(null);
  const terminalPlacementRef = useRef(terminalPlacement);
  terminalPlacementRef.current = terminalPlacement;
  const projectRoute = location.pathname.match(/^\/workspace\/[^/]+\/project\/([^/]+)(?:\/|$)/u);
  const workspaceRoute = location.pathname.match(/^\/workspace\/([^/]+)(?:\/|$)/u);
  const threadRoute = location.pathname.match(
    /^\/workspace\/[^/]+\/project\/[^/]+\/thread\/([^/]+)$/u,
  );
  const currentProject = projectRoute
    ? (projects.find((project) => project.id === decodeURIComponent(projectRoute[1])) ?? null)
    : null;
  const currentWorkspaceId = workspaceRoute ? decodeURIComponent(workspaceRoute[1]) : null;
  const currentThreadId = threadRoute ? decodeURIComponent(threadRoute[1]) : null;
  const currentProjectThreads = useMemo(
    () =>
      currentProject && currentWorkspaceId
        ? getProjectThreads(
            threads.filter(
              (thread) =>
                thread.workspaceId === currentWorkspaceId &&
                thread.projectId === currentProject.id &&
                !thread.archived,
            ),
          )
        : [],
    [currentProject, currentWorkspaceId, threads],
  );
  const newThreadProjects = associations
    .filter(
      (association) =>
        association.workspaceId === activeWorkspaceId &&
        projectDirectoryStatusById[association.projectId] === "available",
    )
    .flatMap((association) => {
      const project = projects.find((item) => item.id === association.projectId);
      return project ? [{ association, project }] : [];
    });
  const canOpenTerminal =
    currentProject != null && projectDirectoryStatusById[currentProject.id] === "available";
  const isBottomTerminalOpen = isTerminalOpen && terminalPlacement === "bottom";
  const secondaryPaneKind = getSecondaryPaneKind(location.pathname);
  const secondaryPane =
    secondaryPaneKind === "settings" ? (
      <SettingsTabsPane />
    ) : secondaryPaneKind === "workspace" ? (
      <WorkspaceNavigationPane />
    ) : (
      <ThreadHistoryPane />
    );

  const toggleSecondaryPane = useCallback(() => {
    setIsSecondaryPaneCollapsed((collapsed) => !collapsed);
  }, []);

  useEffect(() => {
    window.carrent.keybindings.setBindings(buildEffectiveKeybindingMap(keybindingOverrides));
  }, [keybindingOverrides]);

  useEffect(() => {
    if (!isNewThreadProjectPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsNewThreadProjectPickerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isNewThreadProjectPickerOpen]);

  const openSearchDialog = useCallback(() => setIsThreadSearchOpen(true), []);
  const openNewThreadDraft = useCallback(
    async (workspaceId: string, projectId: string) => {
      const draft = await openThreadDraft(workspaceId, projectId);
      if (draft) navigate(buildProjectPath(workspaceId, projectId));
      setIsNewThreadProjectPickerOpen(false);
    },
    [navigate, openThreadDraft],
  );
  const createNewThread = useCallback(() => {
    if (newThreadProjects.length === 1 && activeWorkspaceId) {
      void openNewThreadDraft(activeWorkspaceId, newThreadProjects[0].project.id);
    } else if (newThreadProjects.length > 1) {
      setIsNewThreadProjectPickerOpen(true);
    }
  }, [activeWorkspaceId, newThreadProjects, openNewThreadDraft]);
  const createNewLocalThread = useCallback(() => {
    if (!currentWorkspaceId || !currentProject || !canOpenTerminal) return;
    void openNewThreadDraft(currentWorkspaceId, currentProject.id);
  }, [canOpenTerminal, currentProject, currentWorkspaceId, openNewThreadDraft]);
  const toggleTerminal = useCallback(() => {
    if (!canOpenTerminal) return;
    if (isBottomTerminalOpen) {
      setIsTerminalOpen(false);
    } else {
      setTerminalPlacement("bottom");
      setIsTerminalOpen(true);
    }
  }, [canOpenTerminal, isBottomTerminalOpen]);
  const navigateToThreadIndex = useCallback(
    (index: number) => {
      if (!currentWorkspaceId || !currentProject) return;
      const thread = currentProjectThreads[index];
      if (!thread || thread.id === currentThreadId) return;
      navigate(buildThreadPath(currentWorkspaceId, currentProject.id, thread.id));
    },
    [currentProject, currentProjectThreads, currentThreadId, currentWorkspaceId, navigate],
  );
  const navigateAdjacentThread = useCallback(
    (direction: -1 | 1) => {
      if (currentProjectThreads.length === 0) return;
      const currentIndex = currentProjectThreads.findIndex(
        (thread) => thread.id === currentThreadId,
      );
      const startIndex = currentIndex < 0 ? (direction === 1 ? -1 : 0) : currentIndex;
      const nextIndex =
        (startIndex + direction + currentProjectThreads.length) % currentProjectThreads.length;
      navigateToThreadIndex(nextIndex);
    },
    [currentProjectThreads, currentThreadId, navigateToThreadIndex],
  );
  useKeybinding("search-threads", openSearchDialog);
  useKeybinding("toggle-sidebar", toggleSecondaryPane);
  useKeybinding("toggle-terminal", toggleTerminal);
  useKeybinding("new-thread", createNewThread);
  useKeybinding("new-local-thread", createNewLocalThread);
  useKeybinding("thread-previous", () => navigateAdjacentThread(-1));
  useKeybinding("thread-next", () => navigateAdjacentThread(1));
  useKeybinding("thread-jump-1", () => navigateToThreadIndex(0));
  useKeybinding("thread-jump-2", () => navigateToThreadIndex(1));
  useKeybinding("thread-jump-3", () => navigateToThreadIndex(2));
  useKeybinding("thread-jump-4", () => navigateToThreadIndex(3));
  useKeybinding("thread-jump-5", () => navigateToThreadIndex(4));
  useKeybinding("thread-jump-6", () => navigateToThreadIndex(5));
  useKeybinding("thread-jump-7", () => navigateToThreadIndex(6));
  useKeybinding("thread-jump-8", () => navigateToThreadIndex(7));
  useKeybinding("thread-jump-9", () => navigateToThreadIndex(8));

  const openTerminal = useCallback((placement: TerminalPlacement) => {
    setTerminalPlacement(placement);
    setIsTerminalOpen(true);
  }, []);
  const closeTerminal = useCallback(() => setIsTerminalOpen(false), []);
  const setTerminalSideTarget = useCallback((container: HTMLElement | null) => {
    setTerminalSideContainer(container);
    if (!container && terminalPlacementRef.current === "side") setIsTerminalOpen(false);
  }, []);
  const terminalPanelValue = useMemo(
    () => ({
      isOpen: isTerminalOpen,
      placement: terminalPlacement,
      openTerminal,
      closeTerminal,
      setSideContainer: setTerminalSideTarget,
    }),
    [closeTerminal, isTerminalOpen, openTerminal, setTerminalSideTarget, terminalPlacement],
  );

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
        setSecondaryPaneWidth((width) => {
          window.localStorage.setItem(SECONDARY_PANE_WIDTH_STORAGE_KEY, String(width));
          return width;
        });
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [secondaryPaneWidth],
  );

  return (
    <TerminalPanelProvider value={terminalPanelValue}>
      <div className="h-screen w-screen overflow-hidden bg-bg text-fg">
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-sidebar shadow-[0_0_0_1px_rgb(255_255_255/0.02),0_18px_48px_rgb(0_0_0/0.18)]">
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
                className="relative flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:scale-95"
              >
                <PanelLeftOpen
                  aria-hidden="true"
                  className={`panel-fade absolute h-4 w-4 ${
                    isSecondaryPaneCollapsed ? "opacity-100" : "opacity-0"
                  }`}
                />
                <PanelLeftClose
                  aria-hidden="true"
                  className={`panel-fade h-4 w-4 ${
                    isSecondaryPaneCollapsed ? "opacity-0" : "opacity-100"
                  }`}
                />
              </button>
              <button
                type="button"
                aria-label="Search Threads"
                title="Search Threads"
                onClick={openSearchDialog}
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
                    isBottomTerminalOpen ? "Hide Integrated Terminal" : "Show Integrated Terminal"
                  }
                  title={
                    isBottomTerminalOpen ? "Hide Integrated Terminal" : "Show Integrated Terminal"
                  }
                  aria-pressed={isBottomTerminalOpen}
                  onClick={toggleTerminal}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover active:scale-95 ${
                    isBottomTerminalOpen ? "text-fg" : "text-subtle hover:text-fg"
                  }`}
                >
                  <SquareTerminal className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </header>

          <div className="flex min-h-0 flex-1 bg-bg">
            <div className="min-h-0 shrink-0" style={{ width: LEFT_SIDEBAR_WIDTH }}>
              <WorkspaceRail />
            </div>

            <div className="min-h-0 min-w-0 flex-1 bg-sidebar pb-1.5 pr-1.5">
              <div className="flex h-full min-h-0">
                <div
                  className={`min-h-0 shrink-0 overflow-hidden ${
                    isResizing ? "panel-dragging" : "panel-collapse-x"
                  }`}
                  style={{ width: isSecondaryPaneCollapsed ? 0 : secondaryPaneWidth }}
                >
                  <div className="h-full" style={{ width: secondaryPaneWidth }}>
                    {secondaryPane}
                  </div>
                </div>

                {!isSecondaryPaneCollapsed && (
                  <div onMouseDown={handleResizeStart} className="w-1 shrink-0 cursor-col-resize" />
                )}

                <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
                  <IntegratedTerminal
                    project={currentProject}
                    threadId={threadRoute ? decodeURIComponent(threadRoute[1]) : null}
                    isOpen={isTerminalOpen && canOpenTerminal}
                    onOpenChange={setIsTerminalOpen}
                    placement={terminalPlacement}
                    sideContainer={terminalSideContainer}
                  />
                </main>
              </div>
            </div>
          </div>
          <WindowZoomControl />
        </div>
        {isThreadSearchOpen && (
          <ThreadSearchDialog
            threads={threads}
            workspaces={workspaces}
            projects={projects}
            associations={associations}
            onClose={() => setIsThreadSearchOpen(false)}
            onSelect={(entry) => {
              setIsThreadSearchOpen(false);
              const path = buildThreadPath(
                entry.thread.workspaceId,
                entry.thread.projectId,
                entry.thread.id,
              );
              if (path === location.pathname) return;
              // Navigate before selecting; see WorkspaceRail for why the order
              // matters (avoids an activeWorkspaceId bounce).
              navigate(path);
              void selectWorkspace(entry.thread.workspaceId).catch((error) => {
                console.error("[app-state] failed to select Workspace", error);
              });
            }}
          />
        )}
        {isNewThreadProjectPickerOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a project for the new thread"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsNewThreadProjectPickerOpen(false);
            }}
          >
            <div className="w-full max-w-sm overflow-hidden rounded-lg border border-border-strong bg-surface shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-app-14 font-medium text-fg">New thread</h2>
                <button
                  type="button"
                  aria-label="Close project picker"
                  onClick={() => setIsNewThreadProjectPickerOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto p-2">
                {newThreadProjects.map(({ association, project }) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => void openNewThreadDraft(association.workspaceId, project.id)}
                    className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-app-13 text-fg transition hover:bg-surface-hover"
                  >
                    <SquarePen className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 truncate">{association.alias ?? project.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TerminalPanelProvider>
  );
}
