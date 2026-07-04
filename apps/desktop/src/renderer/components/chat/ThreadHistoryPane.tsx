import { Archive, Pin, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useWorkspace } from "../../context/WorkspaceContext";
import { useRuntimes } from "../../hooks/useRuntimes";
import { formatRelativeTime } from "../../lib/formatRelativeTime";
import { buildProjectPath, buildThreadPath, getProjectIdFromPathname } from "../../lib/navigation";
import { splitProjectThreads } from "../../lib/projectThreads";
import { getChatRuntimeOptions } from "../../lib/runtimeSelection";
import { findProjectIdForThread } from "../../lib/workspaceState";

export function ThreadHistoryPane() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    projects,
    activeThreadId,
    setActiveThreadId,
    toggleThreadPin,
    archiveThread,
    createThread,
  } = useWorkspace();
  const { runtimes } = useRuntimes();
  const defaultRuntimeId = getChatRuntimeOptions(runtimes)[0]?.id;
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);

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
    if (!selectedProject) {
      return;
    }

    const thread = createThread(selectedProject.id, "New thread", defaultRuntimeId);
    if (thread) {
      navigate(buildThreadPath(selectedProject.id, thread.id));
    }
  };

  const archiveThreadAction = (threadId: string) => {
    if (!selectedProject || !window.confirm("Archive this thread?")) {
      return;
    }

    const nextActiveThreadId = archiveThread(selectedProject.id, threadId);
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
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex h-11 shrink-0 items-center justify-center border-b border-border/70 px-3">
        <div className="min-w-0 text-center">
          <div className="truncate text-[13px] font-semibold text-fg">
            {selectedProject?.name ?? "No project"}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 py-3">
        <button
          onClick={createThreadAndOpen}
          disabled={!selectedProject}
          className="flex h-8 flex-1 items-center justify-center gap-2 rounded-lg bg-surface text-[13px] font-medium text-fg transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          New thread
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {!selectedProject ? (
          <div className="px-4 py-8 text-center text-[13px] text-subtle">Add a project first</div>
        ) : projectThreads.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-muted">No threads yet</p>
            <p className="mt-1 text-[12px] text-subtle">Start a new thread in this project</p>
          </div>
        ) : (
          <div className="space-y-3">
            <section>
              <div className="px-2 pb-1 text-[11px] font-medium uppercase text-subtle">
                Sessions
              </div>
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
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {thread.title}
                          </span>
                          {!showActions && (
                            <span className="shrink-0 text-[11px] text-subtle">
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
                                archiveThreadAction(thread.id);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-danger"
                              aria-label="Archive thread"
                              title="Archive"
                            >
                              <Archive className="h-3.5 w-3.5" />
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
