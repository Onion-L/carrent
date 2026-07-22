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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
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

type ProjectActionsProject = {
  id: string;
  name: string;
  path: string;
};

type ProjectActionsMenuTriggerRect = Pick<
  DOMRect,
  "left" | "top" | "right" | "bottom" | "width" | "height"
>;

export type ProjectActionsMenuPosition = {
  top: number;
  left: number;
};

const PROJECT_ACTIONS_MENU_MARGIN = 8;

export function getProjectActionsMenuPosition(
  triggerRect: ProjectActionsMenuTriggerRect,
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = PROJECT_ACTIONS_MENU_MARGIN,
): ProjectActionsMenuPosition {
  const maxLeft = Math.max(margin, viewport.width - menuSize.width - margin);
  const maxTop = Math.max(margin, viewport.height - menuSize.height - margin);
  const rightLeft = triggerRect.right + margin;
  const leftLeft = triggerRect.left - menuSize.width - margin;
  const preferredLeft =
    rightLeft + menuSize.width <= viewport.width - margin ? rightLeft : leftLeft;

  return {
    left: Math.min(Math.max(preferredLeft, margin), maxLeft),
    top: Math.min(Math.max(triggerRect.top, margin), maxTop),
  };
}

type ProjectActionsMenuProps = {
  project: ProjectActionsProject;
  onOpenInFinder: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  firstItemRef?: Ref<HTMLButtonElement>;
};

export function ProjectActionsMenu({
  project,
  onOpenInFinder,
  onRename,
  onCopyPath,
  onDelete,
  firstItemRef,
}: ProjectActionsMenuProps) {
  return (
    <div
      data-project-menu="true"
      role="menu"
      aria-label={`Project actions for ${project.name}`}
      className="w-44 rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
    >
      <button
        ref={firstItemRef}
        role="menuitem"
        onClick={onOpenInFinder}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
      >
        <ExternalLink className="h-3 w-3" />
        Open in Finder
      </button>
      <button
        role="menuitem"
        onClick={onRename}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
      >
        <Pencil className="h-3 w-3" />
        Rename project
      </button>
      <button
        role="menuitem"
        onClick={onCopyPath}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
      >
        <Link className="h-3 w-3" />
        Copy path
      </button>
      <button
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 text-danger transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-danger/25"
      >
        <Trash2 className="h-3 w-3 text-danger" />
        Delete
      </button>
    </div>
  );
}

type ProjectActionsTriggerProps = {
  projectName: string;
  collapsed: boolean;
  menuOpen: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function ProjectActionsTrigger({
  projectName,
  collapsed,
  menuOpen,
  onClick,
}: ProjectActionsTriggerProps) {
  return (
    <button
      data-project-menu-trigger="true"
      onClick={onClick}
      className={
        collapsed
          ? `absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25 ${
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`
          : "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
      }
      aria-label={`Project actions for ${projectName}`}
      title={`Project actions for ${projectName}`}
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </button>
  );
}

type RenameProjectDialogProps = {
  projectName: string;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function RenameProjectDialog({
  projectName,
  value,
  onChange,
  onCancel,
  onSubmit,
}: RenameProjectDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-start bg-black/40 px-4 pt-16 sm:px-20 sm:pt-24"
      role="dialog"
      aria-modal="true"
      aria-label={`Rename ${projectName}`}
      onMouseDown={onCancel}
    >
      <form
        className="w-full max-w-80 rounded-xl border border-border-strong bg-surface p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-app-13 font-semibold text-fg">Rename project</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="mt-4 block text-app-12 font-medium text-muted" htmlFor="rename-project">
          Project name
        </label>
        <input
          id="rename-project"
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1.5 w-full rounded-md border border-border-strong bg-bg px-2.5 py-2 text-app-13 text-fg outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-8 rounded-md px-3 text-app-12 font-medium text-muted transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-8 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
          >
            Rename
          </button>
        </div>
      </form>
    </div>
  );
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
  const [projectMenuAnchorRect, setProjectMenuAnchorRect] =
    useState<ProjectActionsMenuTriggerRect | null>(null);
  const [projectMenuPosition, setProjectMenuPosition] = useState<ProjectActionsMenuPosition | null>(
    null,
  );
  const [renameDialogProject, setRenameDialogProject] = useState<ProjectActionsProject | null>(
    null,
  );
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuFirstItemRef = useRef<HTMLButtonElement>(null);
  const projectMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const activeProjectId = useMemo(
    () => getProjectIdFromPathname(location.pathname),
    [location.pathname],
  );

  const closeProjectMenu = useCallback((returnFocus = false) => {
    setOpenProjectMenuId(null);
    setProjectMenuAnchorRect(null);
    setProjectMenuPosition(null);
    if (returnFocus) {
      requestAnimationFrame(() => projectMenuTriggerRef.current?.focus());
    }
  }, []);

  const updateProjectMenuPosition = useCallback(() => {
    if (!collapsed || !openProjectMenuId || !projectMenuAnchorRect || !projectMenuRef.current) {
      return;
    }

    const menuRect = projectMenuRef.current.getBoundingClientRect();
    if (menuRect.width <= 0 || menuRect.height <= 0) {
      return;
    }

    setProjectMenuPosition(
      getProjectActionsMenuPosition(
        projectMenuAnchorRect,
        { width: menuRect.width, height: menuRect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [collapsed, openProjectMenuId, projectMenuAnchorRect]);

  useLayoutEffect(() => {
    updateProjectMenuPosition();
  }, [updateProjectMenuPosition]);

  useEffect(() => {
    if (!openProjectMenuId) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const inside =
        target instanceof Element &&
        target.closest('[data-project-menu="true"], [data-project-menu-trigger="true"]');
      if (!inside) {
        closeProjectMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeProjectMenu(true);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProjectMenu, openProjectMenuId]);

  useEffect(() => {
    if (!collapsed || !openProjectMenuId) return;

    const handleWindowUpdate = () => updateProjectMenuPosition();
    window.addEventListener("resize", handleWindowUpdate);
    window.addEventListener("scroll", handleWindowUpdate, true);
    return () => {
      window.removeEventListener("resize", handleWindowUpdate);
      window.removeEventListener("scroll", handleWindowUpdate, true);
    };
  }, [collapsed, openProjectMenuId, updateProjectMenuPosition]);

  useEffect(() => {
    if (!openProjectMenuId) return;

    const frame = requestAnimationFrame(() => projectMenuFirstItemRef.current?.focus());
    return () => cancelAnimationFrame(frame);
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

  const closeRenameDialog = () => {
    setRenameDialogProject(null);
    setEditingProjectName("");
  };

  useEffect(() => {
    if (!renameDialogProject) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRenameDialog();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [renameDialogProject]);

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

  const commitDialogProjectRename = () => {
    if (renameDialogProject && renameProject(renameDialogProject.id, editingProjectName)) {
      closeRenameDialog();
    }
  };

  const handleProjectMenuToggle = (
    project: ProjectActionsProject,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    if (openProjectMenuId === project.id) {
      closeProjectMenu();
      return;
    }

    projectMenuTriggerRef.current = event.currentTarget;
    setOpenProjectMenuId(project.id);
    if (collapsed) {
      const rect = event.currentTarget.getBoundingClientRect();
      setProjectMenuAnchorRect({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
      setProjectMenuPosition(null);
    }
  };

  const handleOpenInFinder = (project: ProjectActionsProject) => {
    void window.carrent.shell.openPath(project.path);
    closeProjectMenu();
  };

  const handleRenameProject = (project: ProjectActionsProject) => {
    closeProjectMenu();
    setEditingProjectName(project.name);
    if (collapsed) {
      setRenameDialogProject(project);
      return;
    }

    setEditingProjectId(project.id);
  };

  const handleCopyProjectPath = (project: ProjectActionsProject) => {
    window.carrent.clipboard.writeText(project.path);
    closeProjectMenu();
    showToast("Path copied to clipboard", "success");
  };

  const handleDeleteProject = async (project: ProjectActionsProject) => {
    if (window.confirm(`Delete "${project.name}"?`)) {
      try {
        await removeProject(project.id);
        showToast("Project deleted", "success");
        if (activeProjectId === project.id) {
          navigate("/");
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to delete project.", "error");
      }
    }
    closeProjectMenu();
  };

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
        <div className={`shrink-0 ${collapsed ? "px-2 pb-2 pt-1" : "px-2 pb-2 pt-2"}`}>
          <button
            onClick={() => setIsProjectDialogOpen(true)}
            aria-label="New project"
            title="New project"
            className={`flex min-h-12 w-full items-center justify-center rounded-lg bg-bg text-app-13 font-medium text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border)/0.9)] transition hover:bg-surface-raised active:scale-[0.99] ${
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
              className="flex w-full items-center justify-center rounded-lg border border-dashed border-border px-2 py-5 text-app-12 text-subtle transition hover:border-border-strong hover:text-muted"
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
                    className="group relative"
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
                          className="min-w-0 flex-1 bg-transparent text-app-13 text-fg outline-none"
                        />
                      ) : (
                        <button
                          title={project.name}
                          onClick={() => navigate(buildProjectPath(project.id))}
                          className={
                            collapsed
                              ? `flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-bg text-app-13 font-semibold leading-none shadow-[inset_0_0_0_1px_rgb(var(--color-border)/0.9)] transition ${
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
                              <span className="min-w-0 truncate text-app-13 font-medium">
                                {project.name}
                              </span>
                            </>
                          )}
                        </button>
                      )}

                      {(collapsed || showActions) && editingProjectId !== project.id && (
                        <ProjectActionsTrigger
                          projectName={project.name}
                          collapsed={collapsed}
                          menuOpen={menuOpen}
                          onClick={(event) => handleProjectMenuToggle(project, event)}
                        />
                      )}
                    </div>

                    {menuOpen && !collapsed && (
                      <div className="absolute right-0 top-full z-20 mt-1">
                        <ProjectActionsMenu
                          project={project}
                          onOpenInFinder={() => handleOpenInFinder(project)}
                          onRename={() => handleRenameProject(project)}
                          onCopyPath={() => handleCopyProjectPath(project)}
                          onDelete={() => void handleDeleteProject(project)}
                          firstItemRef={projectMenuFirstItemRef}
                        />
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
              `flex min-h-8 items-center rounded-lg px-2 text-app-13 transition ${
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

      {collapsed &&
        openProjectMenuId &&
        projectMenuAnchorRect &&
        (() => {
          const project = projects.find((item) => item.id === openProjectMenuId);
          if (!project) return null;

          return (
            <div
              ref={projectMenuRef}
              className="fixed z-40"
              style={{
                left: projectMenuPosition?.left ?? -10000,
                top: projectMenuPosition?.top ?? -10000,
                visibility: projectMenuPosition ? "visible" : "hidden",
              }}
            >
              <ProjectActionsMenu
                project={project}
                onOpenInFinder={() => handleOpenInFinder(project)}
                onRename={() => handleRenameProject(project)}
                onCopyPath={() => handleCopyProjectPath(project)}
                onDelete={() => void handleDeleteProject(project)}
                firstItemRef={projectMenuFirstItemRef}
              />
            </div>
          );
        })()}

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
              <h2 className="text-app-13 font-semibold text-fg">New Project</h2>
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
                  <span className="block text-app-13 font-semibold text-fg">
                    Create a new project
                  </span>
                  <span className="mt-0.5 block text-app-12 text-subtle">
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
                  <span className="block text-app-13 font-semibold text-fg">
                    Import existing project
                  </span>
                  <span className="mt-0.5 block text-app-12 text-subtle">Open a local folder</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {renameDialogProject && (
        <RenameProjectDialog
          projectName={renameDialogProject.name}
          value={editingProjectName}
          onChange={setEditingProjectName}
          onCancel={closeRenameDialog}
          onSubmit={commitDialogProjectRename}
        />
      )}
    </>
  );
}
