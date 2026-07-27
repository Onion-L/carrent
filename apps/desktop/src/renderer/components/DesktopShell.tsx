import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThreadHistoryPane } from "./chat/ThreadHistoryPane";
import { SettingsTabsPane } from "./settings/SettingsTabsPane";
import { McpServerControl } from "./mcp/McpServerControl";
import { DesktopHeaderActionsSlot } from "./DesktopHeaderActions";
import { WorkspaceNavigationPane } from "./workspace/WorkspaceNavigationPane";
import { WorkspaceRail } from "./workspace/WorkspaceRail";
import {
  AttentionPane,
  getAttentionViewState,
  type AttentionEntry,
} from "./workspace/AttentionPane";
import { useAppState } from "../context/AppStateContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useChatRun } from "../hooks/useChatRun";
import { getAttentionGroups } from "../lib/projectThreads";
import type { ThreadRecord } from "../mock/uiShellData";
import { ThreadSearchDialog } from "./workspace/ThreadSearchDialog";
import { buildThreadPath, getProjectIdFromPathname } from "../lib/navigation";
import type { ThreadSearchScope } from "../../shared/threadSearch";

const LEFT_SIDEBAR_WIDTH = 58;
const MIN_SECONDARY_PANE_WIDTH = 200;
const MAX_SECONDARY_PANE_WIDTH = 480;
const DEFAULT_SECONDARY_PANE_WIDTH = 280;

type ThreadSearchState = {
  scope: ThreadSearchScope;
  workspaceId?: string;
  projectId?: string;
};

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [isSecondaryPaneCollapsed, setIsSecondaryPaneCollapsed] = useState(false);
  const [secondaryPaneWidth, setSecondaryPaneWidth] = useState(DEFAULT_SECONDARY_PANE_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ x: 0, width: DEFAULT_SECONDARY_PANE_WIDTH });
  const location = useLocation();
  const { workspaces, projects, associations, threads, activeWorkspaceId, selectWorkspace } =
    useAppState();
  const [threadSearch, setThreadSearch] = useState<ThreadSearchState | null>(null);
  const { projects: contentProjects, messages } = useWorkspace();
  const { runningThreadIds, pendingPermissions, pendingQuestions } = useChatRun();
  const attentionGroups = useMemo(() => {
    const contentThreads = new Map(
      contentProjects.flatMap((project) => project.threads.map((thread) => [thread.id, thread])),
    );
    const candidates = threads
      .filter((thread) => !thread.archived)
      .map((thread) => ({
        ...(contentThreads.get(thread.id) ?? {
          id: thread.id,
          title: thread.title,
          updatedAt: thread.lastActivityAt,
        }),
        ...thread,
        title: thread.title,
        updatedAt: thread.lastActivityAt,
        lastActivityAt: thread.lastActivityAt,
      })) satisfies Array<ThreadRecord & (typeof threads)[number]>;

    return getAttentionGroups({
      threads: candidates,
      runningThreadIds,
      pendingApprovals: pendingPermissions,
      pendingQuestions,
      messages,
    }).map((group) => ({
      status: group.status,
      threads: group.threads.flatMap((thread) => {
        const workspace = workspaces.find((item) => item.id === thread.workspaceId);
        const project = projects.find((item) => item.id === thread.projectId);
        const association = associations.find(
          (item) => item.workspaceId === thread.workspaceId && item.projectId === thread.projectId,
        );
        return workspace && project && association
          ? [
              {
                ...thread,
                workspaceName: workspace.name,
                projectName: association.alias ?? project.name,
              } satisfies AttentionEntry,
            ]
          : [];
      }),
    }));
  }, [
    associations,
    contentProjects,
    messages,
    pendingPermissions,
    pendingQuestions,
    projects,
    runningThreadIds,
    threads,
    workspaces,
  ]);
  const attentionCount = attentionGroups.reduce((count, group) => count + group.threads.length, 0);
  const attentionViewState = getAttentionViewState(location.state);
  const attentionViewOpen = attentionViewState !== null;
  const openThreadSearch = useCallback(
    (scope: ThreadSearchScope) => {
      setThreadSearch({
        scope,
        workspaceId: scope.kind === "global" ? (activeWorkspaceId ?? undefined) : scope.workspaceId,
        projectId:
          scope.kind === "association"
            ? scope.projectId
            : (getProjectIdFromPathname(location.pathname) ?? undefined),
      });
    },
    [activeWorkspaceId, location.pathname],
  );
  const secondaryPane = attentionViewOpen ? (
    <AttentionPane groups={attentionViewState.groups ?? attentionGroups} />
  ) : location.pathname === "/settings" ? (
    <SettingsTabsPane />
  ) : location.pathname.startsWith("/workspace/") ? (
    <WorkspaceNavigationPane onOpenSearch={openThreadSearch} />
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
        openThreadSearch({ kind: "global" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openThreadSearch]);

  const workspaceScope = threadSearch?.workspaceId
    ? ({ kind: "workspace", workspaceId: threadSearch.workspaceId } as const)
    : null;
  const associationScope =
    threadSearch?.workspaceId &&
    threadSearch.projectId &&
    associations.some(
      (item) =>
        item.workspaceId === threadSearch.workspaceId && item.projectId === threadSearch.projectId,
    )
      ? ({
          kind: "association",
          workspaceId: threadSearch.workspaceId,
          projectId: threadSearch.projectId,
        } as const)
      : null;

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
          className="drag-region flex shrink-0 items-stretch justify-between bg-sidebar"
          style={{
            height: "env(titlebar-area-height, 38px)",
            paddingLeft: "92px",
            paddingRight: "16px",
          }}
        >
          <div className="no-drag flex h-full items-center">
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
          </div>

          <div className="no-drag flex h-full items-center gap-1">
            <DesktopHeaderActionsSlot />
            <McpServerControl />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-bg">
          <div className="min-h-0 shrink-0" style={{ width: LEFT_SIDEBAR_WIDTH }}>
            <WorkspaceRail attentionCount={attentionCount} />
          </div>

          <div className="min-h-0 min-w-0 flex-1 bg-sidebar p-1.5 pl-0">
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

              <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg">
                {children}
              </main>
            </div>
          </div>
        </div>
      </div>
      {threadSearch && (
        <ThreadSearchDialog
          threads={threads}
          workspaces={workspaces}
          projects={projects}
          associations={associations}
          scope={threadSearch.scope}
          workspaceScope={workspaceScope}
          associationScope={associationScope}
          onScopeChange={(scope) =>
            setThreadSearch((current) => {
              if (!current) return null;
              if (scope.kind === "global") return { ...current, scope };
              if (scope.kind === "workspace") {
                const projectStillApplies = associations.some(
                  (association) =>
                    association.workspaceId === scope.workspaceId &&
                    association.projectId === current.projectId,
                );
                return {
                  ...current,
                  scope,
                  workspaceId: scope.workspaceId,
                  projectId: projectStillApplies ? current.projectId : undefined,
                };
              }
              return {
                ...current,
                scope,
                workspaceId: scope.workspaceId,
                projectId: scope.projectId,
              };
            })
          }
          onClose={() => setThreadSearch(null)}
          onSelect={async (entry) => {
            setThreadSearch(null);
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
