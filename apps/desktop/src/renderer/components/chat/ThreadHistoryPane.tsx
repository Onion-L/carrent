import { Pin, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useWorkspace } from "../../context/WorkspaceContext";
import { useRuntimes } from "../../hooks/useRuntimes";
import { formatRelativeTime } from "../../lib/formatRelativeTime";
import { buildProjectPath, buildThreadPath, getProjectIdFromPathname } from "../../lib/navigation";
import { splitProjectThreads } from "../../lib/projectThreads";
import { getChatRuntimeOptions } from "../../lib/runtimeSelection";
import { findProjectIdForThread } from "../../lib/workspaceState";
import { useToast } from "../toast/ToastContext";

export function ThreadHistoryPane() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    projects,
    activeThreadId,
    setActiveThreadId,
    toggleThreadPin,
    deleteThread,
    createThread,
  } = useWorkspace();
  const { runtimes } = useRuntimes();
  const defaultRuntimeId = getChatRuntimeOptions(runtimes)[0]?.id;
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const { showToast } = useToast();
  const creatingRef = useRef(false);

  const routeProjectId = useMemo(
    () => getProjectIdFromPathname(location.pathname),
    [location.pathname],
  );
  const selectedProject =
    projects.find((project) => project.id === routeProjectId) ??
    projects.find((project) => project.active) ??
    projects[0] ??
    null;
  const projectThreads = selectedProject ? splitProjectThreads(selectedProject.threads).active : [];

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

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
        <h2 className="min-w-0 truncate text-app-13 font-semibold text-fg">Sessions</h2>
        <button
          onClick={createThreadAndOpen}
          disabled={!selectedProject}
          className="flex min-h-8 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-app-13 font-medium text-muted transition hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 pt-3">
        {!selectedProject ? (
          <div className="px-4 py-8 text-center text-app-13 text-subtle">Add a project first</div>
        ) : projectThreads.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-app-13 text-muted">No threads yet</p>
            <p className="mt-1 text-app-12 text-subtle">Start a new thread in this project</p>
          </div>
        ) : (
          <div className="space-y-3">
            <section>
              <div className="space-y-0.5">
                {projectThreads.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  const showActions = hoveredThreadId === thread.id;

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
                        onClick={() => {
                          setActiveThreadId(thread.id);
                          navigate(buildThreadPath(selectedProject.id, thread.id));
                        }}
                        className={`hover:cursor-pointer flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left transition ${
                          isActive
                            ? "bg-surface-hover text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong)/0.32)]"
                            : "text-muted hover:bg-surface-raised hover:text-fg"
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2 h-full">
                          {thread.pinned ? (
                            <Pin className="h-3.5 w-3.5 shrink-0 text-subtle" />
                          ) : (
                            <span className="h-2 w-2 shrink-0 rounded-full border border-subtle/70" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-app-13 font-medium">
                            {thread.title}
                          </span>
                          {!showActions && (
                            <span className="shrink-0 text-app-11 text-subtle">
                              {formatRelativeTime(thread.updatedAt)}
                            </span>
                          )}
                        </div>

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
                                void deleteThreadAction(thread.id);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-danger"
                              aria-label="Delete thread"
                              title="Delete"
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
