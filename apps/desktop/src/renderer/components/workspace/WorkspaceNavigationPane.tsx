import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Ellipsis,
  ExternalLink,
  Folder,
  FolderOpen,
  Link,
  Pencil,
  Pin,
  SquarePen,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { getThreadRuntimeSessionId } from "../../../shared/providerSessions";
import type { AppThreadRecord } from "../../../shared/workspacePersistence";
import { useAppState } from "../../context/AppStateContext";
import { useThreadContent } from "../../context/ThreadContentContext";
import { removeThreadWork } from "../../hooks/chatMessageQueue";
import { useChatRun } from "../../hooks/useChatRun";
import { useThreadActions } from "../../hooks/useThreadActions";
import { buildProjectPath, buildThreadPath, buildWorkspacePath } from "../../lib/navigation";
import {
  getThreadDisplayStatus,
  getProjectThreads,
  type ThreadDisplayStatus,
} from "../../lib/projectThreads";
import { getWorkspaceProjects } from "../../lib/workspaceProjects";
import { MarqueeText } from "../MarqueeText";
import { useToast } from "../toast/ToastContext";
import { ConfirmDialog } from "../ConfirmDialog";
import { AddProjectButton } from "./AddProjectButton";
import { ThreadContextMenu } from "./ThreadContextMenu";

const STATUS_META: Record<ThreadDisplayStatus, { label: string; className: string }> = {
  approval: { label: "Approval", className: "font-medium text-warning" },
  question: { label: "Question", className: "font-medium text-warning" },
  running: { label: "Running", className: "text-success" },
  compacting: { label: "Compacting", className: "text-success" },
  failed: { label: "Failed", className: "font-medium text-danger" },
};

// A project shows only the first few threads once it has more than the
// threshold; a "Show more" button expands the rest in place.
const THREAD_LIST_COLLAPSE_THRESHOLD = 10;
const THREAD_LIST_PREVIEW_COUNT = 5;

export function WorkspaceNavigationPane() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const {
    workspaces,
    projects,
    associations,
    threads,
    activeWorkspaceId,
    openThreadDraft,
    archiveThread,
    archiveNavigation,
    setArchiveNavigation,
    setProjectAlias,
    removeAssociation,
    projectDirectoryStatusById,
  } = useAppState();
  const { messages, renameThread, toggleThreadPin, deleteThreads } = useThreadContent();
  const { runningThreadIds, pendingPermissions, pendingQuestions, stop } = useChatRun();
  const { compactingThreadIds } = useThreadActions();
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [expandedThreadListProjectIds, setExpandedThreadListProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [threadMenu, setThreadMenu] = useState<{
    threadId: string;
    x: number;
    y: number;
    sessionId: string | null | undefined;
  } | null>(null);
  const threadMenuTriggerRef = useRef<HTMLElement | null>(null);
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<{
    workspaceId: string;
    projectId: string;
    displayName: string;
  } | null>(null);
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const workspaceProjects = getWorkspaceProjects(projects, associations, activeWorkspaceId);
  const pendingRemovalThreadCount = pendingProjectRemoval
    ? threads.filter(
        (thread) =>
          thread.workspaceId === pendingProjectRemoval.workspaceId &&
          thread.projectId === pendingProjectRemoval.projectId,
      ).length
    : 0;

  const toggleThreadListExpanded = (projectId: string) => {
    setExpandedThreadListProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  // Keep newly created threads visible: when a thread appears in a project
  // whose list is still collapsed, expand that list.
  const knownThreadIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const previousIds = knownThreadIdsRef.current;
    knownThreadIdsRef.current = new Set(threads.map((thread) => thread.id));
    if (!previousIds) return;
    const newProjectIds = new Set(
      threads
        .filter((thread) => !previousIds.has(thread.id) && !thread.archived)
        .map((thread) => thread.projectId),
    );
    if (newProjectIds.size === 0) return;
    setExpandedThreadListProjectIds((prev) => new Set([...prev, ...newProjectIds]));
  }, [threads]);

  const commitProjectRename = async (
    workspaceId: string,
    projectId: string,
    currentName: string,
  ) => {
    const nextName = editingProjectName.trim();
    setEditingProjectId(null);
    setEditingProjectName("");
    if (!nextName || nextName === currentName) return;

    if (!(await setProjectAlias(workspaceId, projectId, nextName))) {
      showToast("Project could not be renamed.", "error");
    }
  };

  const confirmProjectRemoval = async () => {
    if (!pendingProjectRemoval) return;
    const { workspaceId, projectId } = pendingProjectRemoval;
    setPendingProjectRemoval(null);
    const projectPath = buildProjectPath(workspaceId, projectId);
    const projectIsActive =
      location.pathname === projectPath || location.pathname.startsWith(`${projectPath}/`);
    let removed = false;
    try {
      removed = await removeAssociation(workspaceId, projectId, (threadIds, snapshots) =>
        deleteThreads(threadIds, snapshots),
      );
    } catch (error) {
      console.error("[associations] removal rollback failed", error);
    }
    if (removed && projectIsActive) {
      navigate(buildWorkspacePath(workspaceId));
    } else if (!removed) {
      showToast("Project could not be deleted.", "error");
    }
  };

  const closeThreadMenu = useCallback((returnFocus = false) => {
    setThreadMenu(null);
    if (returnFocus) {
      window.requestAnimationFrame(() => threadMenuTriggerRef.current?.focus());
    }
  }, []);

  const openThreadMenu = (thread: AppThreadRecord, event: React.MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('[data-thread-menu="true"]')) {
      // Right-clicking inside the open menu bubbles through the portal to the
      // row's onContextMenu; keep the current menu as is.
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.target instanceof Element ? event.target.closest("button") : null;
    threadMenuTriggerRef.current = trigger instanceof HTMLElement ? trigger : null;
    const triggerRect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || triggerRect.left + 12;
    const y = event.clientY || triggerRect.top + 12;
    setThreadMenu({ threadId: thread.id, x, y, sessionId: undefined });

    void window.carrent.providerSessions
      .load()
      .then((snapshot) => {
        const sessionId = getThreadRuntimeSessionId(snapshot, thread);
        setThreadMenu((current) =>
          current?.threadId === thread.id ? { ...current, sessionId } : current,
        );
      })
      .catch(() => {
        setThreadMenu((current) =>
          current?.threadId === thread.id ? { ...current, sessionId: null } : current,
        );
      });
  };

  const copyThreadMenuValue = async (value: string, successMessage: string) => {
    try {
      await window.carrent.clipboard.writeText(value);
      closeThreadMenu();
      showToast(successMessage, "success");
    } catch {
      showToast("Failed to copy to clipboard", "error");
    }
  };

  const openInFinder = async (workingDirectory: string) => {
    try {
      const error = await window.carrent.shell.openPath(workingDirectory);
      if (error) showToast(error, "error");
    } catch {
      showToast("Project could not be opened in Finder.", "error");
    }
  };

  const openThreadInNewWindow = async (
    workspaceId: string,
    projectId: string,
    threadId: string,
  ) => {
    try {
      await window.carrent.mainWindow.windows.openThread(
        buildThreadPath(workspaceId, projectId, threadId),
      );
      closeThreadMenu();
    } catch {
      showToast("Thread could not be opened in a new window.", "error");
    }
  };

  useEffect(() => {
    closeThreadMenu();
  }, [closeThreadMenu, workspace?.id]);

  useEffect(() => {
    if (!openProjectMenuId) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-project-menu]")) {
        setOpenProjectMenuId(null);
      }
    };
    const closeMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenProjectMenuId(null);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, [openProjectMenuId]);

  useEffect(() => {
    if (
      archiveNavigation &&
      threads.some((thread) => thread.id === archiveNavigation.threadId && thread.archived)
    ) {
      // archiveNavigation is cleared by the NavigationCoordinator once the
      // route has actually moved off the archived Thread.
      navigate(archiveNavigation.destinationPath, { replace: true });
    }
  }, [archiveNavigation, navigate, threads]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-r border-border bg-bg">
      {workspace && (
        <div className="flex min-h-12 shrink-0 items-center gap-1 px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={() => navigate(buildWorkspacePath(workspace.id))}
            className="min-w-0 flex-1 truncate text-left text-app-13 font-semibold text-fg transition hover:text-muted"
          >
            {workspace.name}
          </button>
          <AddProjectButton iconOnly workspaceId={workspace.id} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {workspaceProjects.map(({ association, project }) => {
          const projectPath = buildProjectPath(association.workspaceId, project.id);
          const displayName = association.alias ?? project.name;
          const projectThreads = getProjectThreads(
            threads.filter(
              (thread) =>
                thread.workspaceId === association.workspaceId &&
                thread.projectId === project.id &&
                !thread.archived,
            ),
          );
          const projectUnavailable = projectDirectoryStatusById[project.id] === "unavailable";
          const expanded = !collapsedProjectIds.has(project.id);
          const threadListExpanded = expandedThreadListProjectIds.has(project.id);
          const threadListCollapsible = projectThreads.length > THREAD_LIST_COLLAPSE_THRESHOLD;
          const visibleThreads =
            threadListCollapsible && !threadListExpanded
              ? projectThreads.slice(0, THREAD_LIST_PREVIEW_COUNT)
              : projectThreads;
          const hasAffectedLiveRun = threads.some(
            (thread) =>
              thread.workspaceId === association.workspaceId &&
              thread.projectId === project.id &&
              runningThreadIds.includes(thread.id),
          );

          return (
            <section key={project.id} className="py-0.5">
              <div className="group/project flex min-h-9 items-center gap-1 rounded-md px-1.5 text-fg transition hover:bg-surface-hover">
                {editingProjectId === project.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {expanded ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-muted" />
                    )}
                    <input
                      autoFocus
                      aria-label={`Rename project ${displayName}`}
                      value={editingProjectName}
                      onChange={(event) => setEditingProjectName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingProjectId(null);
                          setEditingProjectName("");
                        }
                      }}
                      onBlur={() =>
                        void commitProjectRename(association.workspaceId, project.id, displayName)
                      }
                      className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2 text-app-13 font-medium text-fg outline-none ring-2 ring-fg/10"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${displayName}`}
                    onClick={() =>
                      setCollapsedProjectIds((current) => {
                        const next = new Set(current);
                        if (next.has(project.id)) {
                          next.delete(project.id);
                        } else {
                          next.add(project.id);
                        }
                        return next;
                      })
                    }
                    title={project.workingDirectory}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20"
                  >
                    {expanded ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-muted" />
                    )}
                    <span className="truncate text-app-13 font-medium">{displayName}</span>
                  </button>
                )}
                {projectUnavailable && (
                  <button
                    type="button"
                    aria-label={`${displayName} directory unavailable`}
                    title="Project Working Directory unavailable"
                    onClick={() => navigate(projectPath)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-danger transition hover:bg-danger/10"
                  >
                    <TriangleAlert className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="flex shrink-0 opacity-0 transition group-hover/project:opacity-100 group-focus-within/project:opacity-100">
                  <div className="relative" data-project-menu>
                    <button
                      type="button"
                      aria-label={`More actions for ${displayName}`}
                      aria-haspopup="menu"
                      aria-expanded={openProjectMenuId === project.id}
                      title="More actions"
                      onClick={() =>
                        setOpenProjectMenuId((current) =>
                          current === project.id ? null : project.id,
                        )
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                    >
                      <Ellipsis className="h-3.5 w-3.5" />
                    </button>
                    {openProjectMenuId === project.id && (
                      <div
                        role="menu"
                        aria-label={`Actions for ${displayName}`}
                        className="absolute right-0 top-8 z-20 w-52 rounded-xl border border-border-strong bg-surface p-1.5 shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenProjectMenuId(null);
                            void openInFinder(project.workingDirectory);
                          }}
                          className="flex min-h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-app-13 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
                        >
                          <ExternalLink className="h-4 w-4 shrink-0 text-muted" />
                          Open in Finder
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenProjectMenuId(null);
                            setEditingProjectId(project.id);
                            setEditingProjectName(displayName);
                          }}
                          className="flex min-h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-app-13 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
                        >
                          <Pencil className="h-4 w-4 shrink-0 text-muted" />
                          Rename project
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={async () => {
                            try {
                              await window.carrent.clipboard.writeText(project.workingDirectory);
                              setOpenProjectMenuId(null);
                              showToast("Project path copied.", "success");
                            } catch {
                              showToast("Failed to copy Project path.", "error");
                            }
                          }}
                          className="flex min-h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-app-13 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
                        >
                          <Link className="h-4 w-4 shrink-0 text-muted" />
                          Copy path
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={hasAffectedLiveRun}
                          title={
                            hasAffectedLiveRun
                              ? "Stop the affected live Run before deleting"
                              : undefined
                          }
                          onClick={() => {
                            setOpenProjectMenuId(null);
                            setPendingProjectRemoval({
                              workspaceId: association.workspaceId,
                              projectId: project.id,
                              displayName,
                            });
                          }}
                          className="flex min-h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-app-13 text-danger transition hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-danger/30 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4 shrink-0" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={projectUnavailable}
                    aria-label={`New thread in ${displayName}`}
                    title={
                      projectUnavailable ? "Project Working Directory unavailable" : "New thread"
                    }
                    onClick={async () => {
                      const draft = await openThreadDraft(association.workspaceId, project.id);
                      if (!draft) return;
                      navigate(projectPath);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="space-y-0.5">
                  {projectThreads.length === 0 ? (
                    <p className="flex min-h-9 items-center pl-12 pr-3 text-app-12 text-subtle">
                      No threads yet
                    </p>
                  ) : (
                    <>
                      {visibleThreads.map((thread) => {
                        const threadPath = buildThreadPath(
                          association.workspaceId,
                          project.id,
                          thread.id,
                        );
                        const status = getThreadDisplayStatus({
                          threadId: thread.id,
                          runningThreadIds,
                          compactingThreadIds,
                          pendingApprovals: pendingPermissions,
                          pendingQuestions,
                          messages,
                        });
                        const statusMeta = status ? STATUS_META[status] : null;
                        const active = location.pathname === threadPath;
                        const archiveBlockedReason = compactingThreadIds.includes(thread.id)
                          ? "Wait for Compact to finish before archiving"
                          : null;

                        const handleArchive = async () => {
                          if (archiveBlockedReason) return;
                          const nextThread = projectThreads.find((item) => item.id !== thread.id);
                          if (active) {
                            setArchiveNavigation({
                              threadId: thread.id,
                              sourcePath: threadPath,
                              destinationPath: nextThread
                                ? buildThreadPath(
                                    association.workspaceId,
                                    project.id,
                                    nextThread.id,
                                  )
                                : projectPath,
                            });
                          }
                          // Allow archiving mid-run: stop any live Run, then
                          // clear queued messages (and the draft) for it first.
                          if (runningThreadIds.includes(thread.id)) {
                            await stop(thread.id);
                          }
                          removeThreadWork([thread.id]);
                          const archived = await archiveThread(thread.id);
                          if (!archived) {
                            if (active) setArchiveNavigation(null);
                            showToast("Thread could not be archived.", "error");
                          } else {
                            showToast("Thread archived.", "success", {
                              label: "View",
                              onClick: () => navigate("/settings?tab=archives"),
                            });
                          }
                        };

                        return (
                          <div
                            key={thread.id}
                            className="group/thread"
                            onContextMenu={(event) => openThreadMenu(thread, event)}
                          >
                            <div
                              className={`flex min-h-9 items-center gap-1 rounded-md pl-12 pr-3 text-left transition ${
                                active
                                  ? "bg-surface-hover text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong)/0.32)]"
                                  : "text-muted hover:bg-surface-hover hover:text-fg"
                              }`}
                            >
                              {editingThreadId === thread.id ? (
                                <div className="flex min-w-0 flex-1 items-center">
                                  <input
                                    autoFocus
                                    aria-label={`Rename ${thread.title}`}
                                    value={editingThreadTitle}
                                    onChange={(event) => setEditingThreadTitle(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                      } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        setEditingThreadId(null);
                                        setEditingThreadTitle("");
                                      }
                                    }}
                                    onBlur={() => {
                                      renameThread(project.id, thread.id, editingThreadTitle);
                                      setEditingThreadId(null);
                                      setEditingThreadTitle("");
                                    }}
                                    className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2 text-app-13 font-medium text-fg outline-none ring-2 ring-fg/10"
                                  />
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    aria-label={thread.title}
                                    onClick={() => navigate(threadPath)}
                                    className="flex min-w-0 flex-1 self-stretch items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20"
                                  >
                                    {thread.pinned && <Pin className="mr-1 h-3 w-3 shrink-0" />}
                                    <MarqueeText
                                      className={`min-w-0 flex-1 text-app-13 ${active ? "font-semibold" : "font-normal"}`}
                                    >
                                      {thread.title}
                                    </MarqueeText>
                                    {statusMeta ? (
                                      <span
                                        className={`shrink-0 text-app-11 group-hover/thread:hidden group-focus-visible/thread:hidden ${statusMeta.className}`}
                                        title={statusMeta.label}
                                      >
                                        {statusMeta.label}
                                      </span>
                                    ) : null}
                                  </button>
                                  <div className="hidden shrink-0 group-hover/thread:flex group-focus-visible/thread:flex">
                                    <button
                                      type="button"
                                      aria-label={
                                        thread.pinned
                                          ? `Unpin ${thread.title}`
                                          : `Pin ${thread.title}`
                                      }
                                      aria-pressed={thread.pinned === true}
                                      title={thread.pinned ? "Unpin" : "Pin"}
                                      onClick={() => toggleThreadPin(project.id, thread.id)}
                                      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-raised hover:text-fg"
                                    >
                                      <Pin
                                        className={`h-3.5 w-3.5 ${thread.pinned ? "fill-current" : ""}`}
                                      />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Rename ${thread.title}`}
                                      title="Rename"
                                      onClick={() => {
                                        setEditingThreadId(thread.id);
                                        setEditingThreadTitle(thread.title);
                                      }}
                                      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-raised hover:text-fg"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={archiveBlockedReason !== null}
                                      aria-label={`Archive ${thread.title}`}
                                      title={archiveBlockedReason ?? "Archive"}
                                      onClick={() => void handleArchive()}
                                      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
                                    >
                                      <Archive className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                            {threadMenu?.threadId === thread.id ? (
                              <ThreadContextMenu
                                anchor={{ x: threadMenu.x, y: threadMenu.y }}
                                threadTitle={thread.title}
                                pinned={thread.pinned === true}
                                sessionId={threadMenu.sessionId}
                                archiveBlockedReason={archiveBlockedReason}
                                onClose={closeThreadMenu}
                                onOpenInNewWindow={() => {
                                  if (activeWorkspaceId) {
                                    void openThreadInNewWindow(
                                      activeWorkspaceId,
                                      project.id,
                                      thread.id,
                                    );
                                  }
                                }}
                                onPin={() => {
                                  toggleThreadPin(project.id, thread.id);
                                  closeThreadMenu();
                                }}
                                onRename={() => {
                                  closeThreadMenu();
                                  setEditingThreadId(thread.id);
                                  setEditingThreadTitle(thread.title);
                                }}
                                onArchive={() => {
                                  closeThreadMenu();
                                  void handleArchive();
                                }}
                                onRevealInFinder={() => {
                                  closeThreadMenu();
                                  void openInFinder(project.workingDirectory);
                                }}
                                onCopySessionId={() => {
                                  const sessionId = threadMenu.sessionId;
                                  if (sessionId) {
                                    void copyThreadMenuValue(sessionId, "Session ID copied");
                                  }
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                      {threadListCollapsible ? (
                        <button
                          type="button"
                          aria-expanded={threadListExpanded}
                          onClick={() => toggleThreadListExpanded(project.id)}
                          className="flex min-h-9 w-full items-center rounded-md pl-12 pr-3 text-left text-app-12 text-subtle transition hover:bg-surface-hover hover:text-fg"
                        >
                          {threadListExpanded
                            ? "Show less"
                            : `Show more (${projectThreads.length - THREAD_LIST_PREVIEW_COUNT})`}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {workspaceProjects.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-app-13 text-muted">No Projects</p>
            <p className="mt-1 text-app-12 text-subtle">Add a Project Working Directory first</p>
          </div>
        )}
      </div>

      {pendingProjectRemoval ? (
        <ConfirmDialog
          title="Delete Project?"
          message={`Remove "${pendingProjectRemoval.displayName}" from "${workspace?.name ?? "Workspace"}"? This permanently deletes ${pendingRemovalThreadCount} ${pendingRemovalThreadCount === 1 ? "Thread" : "Threads"}.`}
          confirmLabel="Delete Project"
          onCancel={() => setPendingProjectRemoval(null)}
          onConfirm={() => void confirmProjectRemoval()}
        />
      ) : null}
    </aside>
  );
}
