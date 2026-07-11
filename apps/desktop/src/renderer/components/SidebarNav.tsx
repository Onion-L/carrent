import {
  ExternalLink,
  FilePlus,
  Folder,
  FolderOpen,
  Link,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { useToast } from "../components/toast/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  buildChatPath,
  buildProjectPath,
  buildThreadPath,
  getProjectIdFromPathname,
} from "../lib/navigation";

export { buildChatPath, buildThreadPath };

export function getWorkspaceNavItems() {
  return [];
}

function getProjectInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "P";
}

export function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { projects, createProject, removeProject, renameProject } = useWorkspace();
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);

  const activeProjectId = useMemo(
    () => getProjectIdFromPathname(location.pathname),
    [location.pathname],
  );

  useEffect(() => {
    if (!openProjectMenuId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside =
        target instanceof Element &&
        target.closest('[data-project-menu="true"], [data-project-menu-trigger="true"]');
      if (!inside) {
        setOpenProjectMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openProjectMenuId]);

  useEffect(() => {
    if (!isProjectDialogOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProjectDialogOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isProjectDialogOpen]);

  const handleNewProject = async () => {
    const result = await window.carrent.dialog.openDirectory();
    if (result.canceled || result.filePaths.length === 0) {
      return;
    }

    const newProject = createProject(result.filePaths[0]);
    if (newProject) {
      setIsProjectDialogOpen(false);
      navigate(buildProjectPath(newProject.id));
    }
  };

  const commitProjectRename = (projectId: string) => {
    renameProject(projectId, editingProjectName);
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
        <div className={`shrink-0 ${collapsed ? "px-2 pb-2 pt-1" : "px-2 pb-2 pt-2"}`}>
          <button
            onClick={() => setIsProjectDialogOpen(true)}
            aria-label="New project"
            title="New project"
            className={`flex h-12 w-full items-center justify-center rounded-lg bg-bg text-[13px] font-medium text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border)/0.9)] transition hover:bg-surface-raised active:scale-[0.99] ${
              collapsed ? "px-0" : "gap-2 px-3"
            }`}
          >
            <Plus className="h-4 w-4 shrink-0 text-muted" />
            {!collapsed && <span>Project</span>}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {projects.length === 0 ? (
            <button
              onClick={handleNewProject}
              className="flex w-full items-center justify-center rounded-lg border border-dashed border-border px-2 py-5 text-[12px] text-subtle transition hover:border-border-strong hover:text-muted"
            >
              {collapsed ? <Plus className="h-4 w-4" /> : "Add project"}
            </button>
          ) : (
            <div className="space-y-0.5">
              {projects.map((project) => {
                const isActive = project.id === activeProjectId;
                const showActions = !collapsed && hoveredProjectId === project.id;
                const menuOpen = openProjectMenuId === project.id;

                return (
                  <div
                    key={project.id}
                    className="relative"
                    onMouseEnter={() => setHoveredProjectId(project.id)}
                    onMouseLeave={() =>
                      setHoveredProjectId((prev) => (prev === project.id ? null : prev))
                    }
                  >
                    <div
                      className={
                        collapsed
                          ? "flex h-12 items-center justify-center"
                          : `flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 transition ${
                              isActive
                                ? "bg-surface-hover text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong)/0.32)]"
                                : "text-muted hover:bg-surface-raised hover:text-fg"
                            }`
                      }
                    >
                      {editingProjectId === project.id && !collapsed ? (
                        <input
                          autoFocus
                          value={editingProjectName}
                          onChange={(e) => setEditingProjectName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitProjectRename(project.id);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingProjectId(null);
                              setEditingProjectName("");
                            }
                          }}
                          onBlur={() => commitProjectRename(project.id)}
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none"
                        />
                      ) : (
                        <button
                          title={project.name}
                          onClick={() => navigate(buildProjectPath(project.id))}
                          className={
                            collapsed
                              ? `flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-bg text-[13px] font-semibold shadow-[inset_0_0_0_1px_rgb(var(--color-border)/0.9)] transition ${
                                  isActive
                                    ? "text-fg ring-1 ring-fg/80"
                                    : "text-muted ring-0 hover:text-fg hover:ring-1 hover:ring-fg/50"
                                }`
                              : "flex min-w-0 flex-1 items-center gap-2 text-left"
                          }
                        >
                          {collapsed ? (
                            getProjectInitial(project.name)
                          ) : (
                            <>
                              <Folder className="h-4 w-4 shrink-0 text-subtle" />
                              <span className="min-w-0 truncate text-[13px] font-medium">
                                {project.name}
                              </span>
                            </>
                          )}
                        </button>
                      )}

                      {showActions && editingProjectId !== project.id && (
                        <button
                          data-project-menu-trigger="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenProjectMenuId(menuOpen ? null : project.id);
                          }}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                          aria-label="Project actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {menuOpen && !collapsed && (
                      <div
                        data-project-menu="true"
                        className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void window.carrent.shell.openPath(project.path);
                            setOpenProjectMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open in Finder
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenProjectMenuId(null);
                            setEditingProjectId(project.id);
                            setEditingProjectName(project.name);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                        >
                          <Pencil className="h-3 w-3" />
                          Rename project
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.carrent.clipboard.writeText(project.path);
                            setOpenProjectMenuId(null);
                            showToast("Path copied to clipboard", "success");
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                        >
                          <Link className="h-3 w-3" />
                          Copy location
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete "${project.name}"?`)) {
                              try {
                                await removeProject(project.id);
                                showToast("Project deleted", "success");
                                if (activeProjectId === project.id) {
                                  navigate("/");
                                }
                              } catch (error) {
                                showToast(
                                  error instanceof Error
                                    ? error.message
                                    : "Failed to delete project.",
                                  "error",
                                );
                              }
                            }
                            setOpenProjectMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger transition hover:bg-surface-hover"
                        >
                          <Trash2 className="h-3 w-3 text-danger" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 px-2 py-2">
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `flex h-8 items-center rounded-lg px-2 text-[13px] transition ${
                collapsed ? "justify-center" : "gap-2"
              } ${
                isActive
                  ? "bg-surface-hover font-medium text-fg"
                  : "text-muted hover:bg-surface-raised hover:text-fg"
              }`
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Settings</span>}
          </NavLink>
        </div>
      </aside>

      {isProjectDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-start bg-black/40 px-20 pt-24"
          role="dialog"
          aria-modal="true"
          aria-label="New Project"
          onMouseDown={() => setIsProjectDialogOpen(false)}
        >
          <div
            className="w-80 rounded-xl border border-border-strong bg-surface p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-fg">New Project</h2>
              <button
                onClick={() => setIsProjectDialogOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <button
                onClick={handleNewProject}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition hover:border-border-strong hover:bg-surface-hover"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-muted">
                  <FilePlus className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-fg">
                    Create a new project
                  </span>
                  <span className="mt-0.5 block text-[12px] text-subtle">
                    Choose a workspace folder
                  </span>
                </span>
              </button>

              <button
                onClick={handleNewProject}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition hover:border-border-strong hover:bg-surface-hover"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-muted">
                  <FolderOpen className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-fg">
                    Import existing project
                  </span>
                  <span className="mt-0.5 block text-[12px] text-subtle">Open a local folder</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
