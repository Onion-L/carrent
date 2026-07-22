import { Pencil, Pin, Search, SquarePen, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useWorkspace } from "../../context/WorkspaceContext";
import { useChatRun } from "../../hooks/useChatRun";
import { useRuntimes } from "../../hooks/useRuntimes";
import { formatAbsoluteTime, formatRelativeTime } from "../../lib/formatRelativeTime";
import { buildProjectPath, buildThreadPath, getProjectIdFromPathname } from "../../lib/navigation";
import {
  getThreadActivityTime,
  getThreadDisplayStatus,
  splitProjectThreads,
  type ThreadDisplayStatus,
} from "../../lib/projectThreads";
import { getChatRuntimeOptions } from "../../lib/runtimeSelection";
import { findProjectIdForThread } from "../../lib/workspaceState";
import { useToast } from "../toast/ToastContext";
import { ThreadSearchDialog } from "./ThreadSearchDialog";

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
  const [searchOpen, setSearchOpen] = useState(false);
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

  useEffect(() => {
    setSearchOpen(false);
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
    setEditingThreadId(null);
    setEditingThreadTitle("");
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="shrink-0 px-3 pb-1 pt-3">
        {selectedProject ? (
          <div className="min-w-0">
            <div
              className="truncate text-app-13 font-semibold text-fg"
              title={selectedProject.name}
            >
              {selectedProject.name}
            </div>
            <div className="truncate text-app-11 text-subtle" title={selectedProject.path}>
              {selectedProject.path}
            </div>
          </div>
        ) : (
          <h2 className="min-w-0 truncate text-app-13 font-semibold text-fg">Threads</h2>
        )}
      </div>

      <div className="shrink-0 space-y-0.5 px-2 pb-1 pt-1">
        <button
          onClick={createThreadAndOpen}
          disabled={!selectedProject}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-app-13 text-muted transition hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SquarePen className="h-4 w-4 shrink-0" />
          New thread
        </button>
        {selectedProject ? (
          <button
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-app-13 text-muted transition hover:bg-surface-hover hover:text-fg"
          >
            <Search className="h-4 w-4 shrink-0" />
            Search
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 pt-1">
        {!selectedProject ? (
          <div className="px-4 py-8 text-center text-app-13 text-subtle">Add a project first</div>
        ) : allProjectThreads.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-app-13 text-muted">No threads yet</p>
            <p className="mt-1 text-app-12 text-subtle">Start a new thread in this project</p>
          </div>
        ) : (
          <div className="space-y-3">
            <section>
              <div className="px-3 pb-1 pt-1 text-app-11 font-medium text-subtle">Threads</div>
              <div className="space-y-0.5">
                {allProjectThreads.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  const isEditing = editingThreadId === thread.id;
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
                    <div key={thread.id} className="group relative">
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
                            {statusMeta ? (
                              <span
                                className={`shrink-0 text-app-11 group-hover:hidden ${statusMeta.className}`}
                                title={statusMeta.label}
                              >
                                {statusMeta.label}
                              </span>
                            ) : null}
                            {!statusMeta && activityAt !== null ? (
                              <span
                                className="shrink-0 text-app-11 text-subtle group-hover:hidden"
                                title={formatAbsoluteTime(activityAt)}
                              >
                                {formatRelativeTime(activityAt, now)}
                              </span>
                            ) : null}
                          </button>
                        )}

                        {!isEditing && (
                          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
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

      {searchOpen && selectedProject ? (
        <ThreadSearchDialog
          threads={allProjectThreads}
          onSelect={(threadId) => {
            setActiveThreadId(threadId);
            navigate(buildThreadPath(selectedProject.id, threadId));
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </aside>
  );
}
