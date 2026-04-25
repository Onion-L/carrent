import {
  Bot,
  Monitor,
  Settings,
  ArrowUpDown,
  Plus,
  FolderOpen,
  Folder,
  Pin,
  MoreHorizontal,
  Archive,
  SquarePen,
  ExternalLink,
  Link,
  Trash2,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useDraftThread } from "../context/DraftThreadContext";
import { splitProjectThreads } from "../lib/projectThreads";

const workspaceNavItems = [
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/runtimes", label: "Runtimes", icon: Monitor },
];

export function buildThreadPath(projectId: string, threadId: string) {
  return `/thread/${projectId}/${threadId}`;
}

export function buildDraftPath(draftId: string) {
  return `/draft/${draftId}`;
}

export function SidebarNav() {
  const navigate = useNavigate();
  const {
    projects,
    activeThreadId,
    setActiveThreadId,
    createProject,
    removeProject,
    toggleThreadPin,
    archiveThread,
  } = useWorkspace();
  const { createDraft } = useDraftThread();
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(
    projects.filter((p) => p.active).map((p) => p.id),
  );
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [openThreadMenuId, setOpenThreadMenuId] = useState<string | null>(null);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);

  const handleThreadClick = (projectId: string, threadId: string) => {
    setActiveThreadId(threadId);
    navigate(buildThreadPath(projectId, threadId));
  };

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  };

  const openDraft = (projectId: string) => {
    const draft = createDraft(projectId);
    if (!draft) {
      return;
    }

    setExpandedProjectIds((prev) =>
      prev.includes(projectId) ? prev : [...prev, projectId],
    );
    navigate(buildDraftPath(draft.draftId));
  };

  useEffect(() => {
    if (!openThreadMenuId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside =
        target instanceof Element &&
        target.closest(
          '[data-thread-menu="true"], [data-thread-menu-trigger="true"]',
        );
      if (!inside) {
        setOpenThreadMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openThreadMenuId]);

  useEffect(() => {
    if (!openProjectMenuId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside =
        target instanceof Element &&
        target.closest(
          '[data-project-menu="true"], [data-project-menu-trigger="true"]',
        );
      if (!inside) {
        setOpenProjectMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openProjectMenuId]);

  const togglePin = (projectId: string, threadId: string) => {
    toggleThreadPin(projectId, threadId);
    setOpenThreadMenuId(null);
  };

  const archiveThreadAction = (projectId: string, threadId: string) => {
    if (!window.confirm("Archive this thread?")) return;

    setOpenThreadMenuId(null);
    archiveThread(projectId, threadId);
  };

  return (
    <aside className="flex h-full flex-col bg-[#1e1e1e]">
      <div
        className="drag-region shrink-0"
        style={{ height: "env(titlebar-area-height, 38px)" }}
      />
      {/* Projects section */}
      <div className="flex max-h-[50%] flex-col">
        <div className="flex items-center justify-between px-4 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666]">
            Projects
          </span>
          <div className="flex items-center gap-1">
            <button className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]">
              <ArrowUpDown className="h-3 w-3" />
            </button>
            <button
              onClick={async () => {
                const result = await window.carrent.dialog.openDirectory();
                if (!result.canceled && result.filePaths.length > 0) {
                  const newProject = createProject(result.filePaths[0]);
                  if (newProject) {
                    setExpandedProjectIds((prev) =>
                      prev.includes(newProject.id)
                        ? prev
                        : [...prev, newProject.id],
                    );
                  }
                }
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]"
              title="New project"
            >
              <SquarePen className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-2 pb-2 mt-1">
          {projects.map((project) => {
            const isExpanded = expandedProjectIds.includes(project.id);
            const { active } = splitProjectThreads(project.threads);

            return (
              <div key={project.id}>
                <div
                  className="relative flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-[#2a2a2a]"
                  onMouseEnter={() => setHoveredProjectId(project.id)}
                  onMouseLeave={() =>
                    setHoveredProjectId((prev) =>
                      prev === project.id ? null : prev,
                    )
                  }
                >
                  <button
                    onClick={() => toggleProjectExpanded(project.id)}
                    className="flex flex-1 items-center gap-1.5 text-left"
                  >
                    {isExpanded ? (
                      <FolderOpen className="h-4 w-4 text-[#888]" />
                    ) : (
                      <Folder className="h-4 w-4 text-[#888]" />
                    )}
                    <span className="text-[13px] font-medium text-[#ddd]">
                      {project.name}
                    </span>
                  </button>
                  {hoveredProjectId === project.id && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDraft(project.id);
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#333] hover:text-[#999]"
                        title="New thread"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        data-project-menu-trigger="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenProjectMenuId(
                            openProjectMenuId === project.id
                              ? null
                              : project.id,
                          );
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#333] hover:text-[#999]"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                    </>
                  )}

                  {openProjectMenuId === project.id && (
                    <div
                      data-project-menu="true"
                      className="absolute right-0 top-full z-10 mt-0.5 w-44 rounded-md border border-[#333] bg-[#252525] py-1 shadow-lg"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.carrent.shell.showInFolder(project.path);
                          setOpenProjectMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#ccc] transition hover:bg-[#333]"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Locate on Disk
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.carrent.clipboard.writeText(project.path);
                          setOpenProjectMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#ccc] transition hover:bg-[#333]"
                      >
                        <Link className="h-3 w-3" />
                        Copy location
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            window.confirm(
                              `Remove "${project.name}" from the list?`,
                            )
                          ) {
                            removeProject(project.id);
                          }
                          setOpenProjectMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400 transition hover:bg-[#333]"
                      >
                        <Trash2 className="h-3 w-3 text-red-400" />
                        Forget project
                      </button>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="ml-5 mt-1">
                    {active.map((thread) => {
                      const isActive = thread.id === activeThreadId;
                      const showActions =
                        isActive || hoveredThreadId === thread.id;
                      const menuOpen = openThreadMenuId === thread.id;

                      return (
                        <div
                          key={thread.id}
                          className={`relative mt-0.5 flex items-center justify-between rounded-md px-3 py-1.5 text-left transition ${
                            isActive
                              ? "bg-[#2a2a2a] text-[#eee]"
                              : "text-[#999] hover:bg-[#252525] hover:text-[#ccc]"
                          }`}
                          onMouseEnter={() => setHoveredThreadId(thread.id)}
                          onMouseLeave={() =>
                            setHoveredThreadId((prev) =>
                              prev === thread.id ? null : prev,
                            )
                          }
                        >
                          <button
                            onClick={() => handleThreadClick(project.id, thread.id)}
                            className="flex flex-1 items-center justify-between text-left"
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              {thread.pinned && (
                                <Pin className="h-3 w-3 text-[#888]" />
                              )}
                              <span className="truncate text-[13px]">
                                {thread.title}
                              </span>
                            </span>
                            {!showActions && (
                              <span className="shrink-0 text-[11px] text-[#555]">
                                {thread.updatedAt}
                              </span>
                            )}
                          </button>
                          {showActions && (
                            <button
                              data-thread-menu-trigger="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenThreadMenuId(
                                  menuOpen ? null : thread.id,
                                );
                              }}
                              className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#333] hover:text-[#999]"
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </button>
                          )}

                          {menuOpen && (
                            <div
                              data-thread-menu="true"
                              className="absolute right-0 top-full z-10 mt-0.5 w-32 rounded-md border border-[#333] bg-[#252525] py-1 shadow-lg"
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePin(project.id, thread.id);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#ccc] transition hover:bg-[#333]"
                              >
                                <Pin className="h-3 w-3" />
                                {thread.pinned ? "Unpin" : "Pin"}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  archiveThreadAction(project.id, thread.id);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400 transition hover:bg-[#333]"
                              >
                                <Archive className="h-3 w-3 text-red-400" />
                                Archive
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}


                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Workspace section */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center px-4 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666]">
            Workspace
          </span>
        </div>
        <nav className="flex-1 overflow-auto px-2 pt-1">
          {workspaceNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition ${
                  isActive
                    ? "bg-[#2a2a2a] font-medium text-[#eee]"
                    : "text-[#999] hover:bg-[#252525] hover:text-[#ccc]"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Settings */}
      <div className="px-2 pb-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition ${
              isActive
                ? "bg-[#2a2a2a] font-medium text-[#eee]"
                : "text-[#999] hover:bg-[#252525] hover:text-[#ccc]"
            }`
          }
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
