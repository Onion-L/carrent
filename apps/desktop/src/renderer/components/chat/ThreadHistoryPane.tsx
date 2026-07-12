import { Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useWorkspace } from "../../context/WorkspaceContext";
import { useChatRun } from "../../hooks/useChatRun";
import { useRuntimes } from "../../hooks/useRuntimes";
import { formatAbsoluteTime, formatRelativeTime } from "../../lib/formatRelativeTime";
import { buildProjectPath, buildThreadPath, getProjectIdFromPathname } from "../../lib/navigation";
import {
  filterProjectThreads,
  getThreadActivityTime,
  getThreadDisplayStatus,
  splitProjectThreads,
  type ThreadDisplayStatus,
} from "../../lib/projectThreads";
import { getChatRuntimeOptions } from "../../lib/runtimeSelection";
import { findProjectIdForThread } from "../../lib/workspaceState";
import { useToast } from "../toast/ToastContext";

const THREAD_STATUS_META: Record<ThreadDisplayStatus, { label: string; className: string }> = {
  running: { label: "Running", className: "text-success" },
  approval: { label: "Approval", className: "font-medium text-warning" },
  failed: { label: "Failed", className: "font-medium text-danger" },
};

export function ThreadHistoryPane() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    projects,
    messages,
    activeThreadId,
    setActiveThreadId,
    toggleThreadPin,
    deleteThread,
    createThread,
    renameThread,
  } = useWorkspace();
  const { runningThreadIds, pendingPermissions } = useChatRun();
  const { runtimes } = useRuntimes();
  const defaultRuntimeId = getChatRuntimeOptions(runtimes)[0]?.id;
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const { showToast } = useToast();
  const creatingRef = useRef(false);
  const cancelRenameRef = useRef(false);

  const routeProjectId = useMemo(
    () => getProjectIdFromPathname(location.pathname),
    [location.pathname],
  );
  const selectedProject =
    projects.find((project) => project.id === routeProjectId) ??
    projects.find((project) => project.active) ??
    projects[0] ??
    null;
  const allProjectThreads = useMemo(
    () => (selectedProject ? splitProjectThreads(selectedProject.threads, messages).active : []),
    [messages, selectedProject],
  );
  const projectThreads = useMemo(
    () => filterProjectThreads(allProjectThreads, searchQuery),
    [allProjectThreads, searchQuery],
  );

  useEffect(() => {
    setSearchQuery("");
    setHoveredThreadId(null);
    setEditingThreadId(null);
    setEditingThreadTitle("");
  }, [selectedProject?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const createThreadAndOpen = () => {
    if (!selectedProject || creatingRef.current) {
      return;
    }

    creatingRef.current = true;
    const thread = createThread(selectedProject.id, "New thread", defaultRuntimeId);
    if (thread) {
      navigate(buildThreadPath(selectedProject.id, thread.id));
    }
    window.setTimeout(() => {
      creatingRef.current = false;
    }, 0);
  };

  const deleteThreadAction = async (threadId: string) => {
    if (!selectedProject) {
      return;
    }

    try {
      const nextActiveThreadId = await deleteThread(selectedProject.id, threadId);
      showToast("Deleted successfully", "success");
      if (activeThreadId === threadId) {
        if (nextActiveThreadId) {
          const nextProjectId = findProjectIdForThread(projects, nextActiveThreadId);
          navigate(
            nextProjectId
              ? buildThreadPath(nextProjectId, nextActiveThreadId)
              : buildProjectPath(selectedProject.id),
          );
        } else {
          navigate(buildProjectPath(selectedProject.id));
        }
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete thread.", "error");
    }
  };

  const commitThreadRename = (threadId: string) => {
    renameThread(selectedProject?.id ?? "", threadId, editingThreadTitle);
    setHoveredThreadId(null);
    setEditingThreadId(null);
    setEditingThreadTitle("");
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
        <h2 className="min-w-0 truncate text-app-13 font-semibold text-fg">Threads</h2>
        <button
          onClick={createThreadAndOpen}
          disabled={!selectedProject}
          className="flex min-h-8 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-app-13 font-medium text-muted transition hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      {selectedProject && allProjectThreads.length > 0 ? (
        <div className="shrink-0 border-b border-border/70 px-2 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
            <input
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setHoveredThreadId(null);
              }}
              placeholder="Search threads"
              aria-label="Search threads"
              className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-8 text-app-12 text-fg outline-none transition placeholder:text-subtle focus:border-border-strong focus:ring-2 focus:ring-fg/10"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setHoveredThreadId(null);
                }}
                aria-label="Clear thread search"
                title="Clear search"
                className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 pt-3">
        {!selectedProject ? (
          <div className="px-4 py-8 text-center text-app-13 text-subtle">Add a project first</div>
        ) : allProjectThreads.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-app-13 text-muted">No threads yet</p>
            <p className="mt-1 text-app-12 text-subtle">Start a new thread in this project</p>
          </div>
        ) : projectThreads.length === 0 ? (
          <div className="px-4 py-8 text-center text-app-13 text-subtle">No matching threads</div>
        ) : (
          <div className="space-y-3">
            <section>
              <div className="space-y-0.5">
                {projectThreads.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  const isEditing = editingThreadId === thread.id;
                  const showActions = hoveredThreadId === thread.id && !isEditing;
                  const status = getThreadDisplayStatus({
                    threadId: thread.id,
                    runningThreadIds,
                    pendingApprovals: pendingPermissions,
                    messages,
                  });
                  const statusMeta = status ? THREAD_STATUS_META[status] : null;
                  const activityAt = getThreadActivityTime(thread, messages);
                  const isRunActive = status === "running" || status === "approval";

                  return (
                    <div
                      key={thread.id}
                      className="relative"
                      onMouseEnter={() => setHoveredThreadId(thread.id)}
                      onMouseLeave={() =>
                        setHoveredThreadId((prev) => (prev === thread.id ? null : prev))
                      }
                    >
                      <div
                        className={`flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left transition ${
                          isActive
                            ? "bg-surface-hover text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong)/0.32)]"
                            : "text-muted hover:bg-surface-raised hover:text-fg"
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex h-full min-w-0 flex-1 items-center gap-2">
                            {thread.pinned ? (
                              <Pin className="h-3.5 w-3.5 shrink-0 text-subtle" />
                            ) : (
                              <span className="h-2 w-2 shrink-0 rounded-full border border-subtle/70" />
                            )}
                            <input
                              autoFocus
                              value={editingThreadTitle}
                              onChange={(event) => setEditingThreadTitle(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelRenameRef.current = true;
                                  setEditingThreadId(null);
                                  setEditingThreadTitle("");
                                }
                              }}
                              onBlur={() => {
                                if (cancelRenameRef.current) {
                                  cancelRenameRef.current = false;
                                  return;
                                }
                                commitThreadRename(thread.id);
                              }}
                              aria-label={`Rename ${thread.title}`}
                              className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2 text-app-13 font-medium text-fg outline-none ring-2 ring-fg/10"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveThreadId(thread.id);
                              navigate(buildThreadPath(selectedProject.id, thread.id));
                            }}
                            className="flex min-w-0 flex-1 self-stretch items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20"
                          >
                            {thread.pinned ? (
                              <Pin className="h-3.5 w-3.5 shrink-0 text-subtle" />
                            ) : (
                              <span className="h-2 w-2 shrink-0 rounded-full border border-subtle/70" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-app-13 font-medium">
                              {thread.title}
                            </span>
                            {!showActions && statusMeta ? (
                              <span
                                className={`shrink-0 text-app-11 ${statusMeta.className}`}
                                title={statusMeta.label}
                              >
                                {statusMeta.label}
                              </span>
                            ) : null}
                            {!showActions && !statusMeta && activityAt !== null ? (
                              <span
                                className="shrink-0 text-app-11 text-subtle"
                                title={formatAbsoluteTime(activityAt)}
                              >
                                {formatRelativeTime(activityAt, now)}
                              </span>
                            ) : null}
                          </button>
                        )}

                        {showActions && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleThreadPin(selectedProject.id, thread.id);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                              aria-label={thread.pinned ? "Unpin thread" : "Pin thread"}
                              title={thread.pinned ? "Unpin" : "Pin"}
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelRenameRef.current = false;
                                setEditingThreadId(thread.id);
                                setEditingThreadTitle(thread.title);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
                              aria-label={`Rename ${thread.title}`}
                              title="Rename"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isRunActive) {
                                  return;
                                }
                                void deleteThreadAction(thread.id);
                              }}
                              disabled={isRunActive}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/25 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-subtle"
                              aria-label="Delete thread"
                              title={isRunActive ? "Stop the run before deleting" : "Delete"}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
