import { Check, ChevronDown, FolderPlus, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppState } from "../../context/AppStateContext";
import { useChatRun } from "../../hooks/useChatRun";
import { getWorkspaceDeleteBlockedReason } from "../../hooks/useDeleteWorkspace";
import { useWorkspaceActionDialogs } from "../../hooks/useWorkspaceActionDialogs";
import { buildWorkspacePath, getWorkspaceRestorePath } from "../../lib/navigation";
import { workspaceAvatarColor } from "../../lib/workspaceAvatar";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";

export function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const {
    workspaces,
    threads,
    lastThreadIdByWorkspace,
    activeWorkspaceId,
    createWorkspace,
    selectWorkspace,
  } = useAppState();
  const { runningThreadIds } = useChatRun();
  const { requestRename, requestDelete, dialogs: actionDialogs } = useWorkspaceActionDialogs();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [menu, setMenu] = useState<{ workspaceId: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const menuWorkspace = menu
    ? (workspaces.find((workspace) => workspace.id === menu.workspaceId) ?? null)
    : null;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!activeWorkspace) return null;

  return (
    <>
      <div ref={containerRef} className="relative min-w-0">
        <button
          type="button"
          aria-label="Select Workspace"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title="Select Workspace"
          onClick={() => setIsOpen((open) => !open)}
          className="flex h-8 max-w-56 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-app-13 font-medium text-fg transition hover:border-border-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20"
        >
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-app-11 font-semibold text-white"
            style={{ backgroundColor: workspaceAvatarColor(activeWorkspace.name) }}
          >
            {activeWorkspace.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate">{activeWorkspace.name}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-subtle transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <div
            role="menu"
            aria-label="Workspaces"
            className="absolute left-0 top-[calc(100%+0.375rem)] z-50 w-64 overflow-hidden rounded-lg border border-border-strong bg-surface py-1.5 shadow-xl"
          >
            <div className="max-h-[min(20rem,60vh)] overflow-y-auto">
              {workspaces.map((workspace) => {
                const active = workspace.id === activeWorkspace.id;
                return (
                  <div
                    key={workspace.id}
                    className="group flex items-center transition hover:bg-surface-hover"
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      aria-label={workspace.name}
                      onClick={async () => {
                        setIsOpen(false);
                        if (active || !(await selectWorkspace(workspace.id))) return;
                        navigate(
                          getWorkspaceRestorePath(workspace.id, threads, lastThreadIdByWorkspace),
                        );
                      }}
                      className="flex min-h-10 min-w-0 flex-1 items-center gap-3 px-3 text-left text-app-14 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-app-12 font-semibold text-white"
                        style={{ backgroundColor: workspaceAvatarColor(workspace.name) }}
                      >
                        {workspace.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      {active && <Check className="h-4 w-4 shrink-0 group-hover:hidden" />}
                    </button>
                    <button
                      type="button"
                      aria-label={`Actions for ${workspace.name}`}
                      title={`Actions for ${workspace.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsOpen(false);
                        setMenu({
                          workspaceId: workspace.id,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      className="mr-2 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25 group-hover:flex group-focus-within:flex"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="my-1 border-t border-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                setIsCreating(true);
              }}
              className="flex min-h-10 w-full items-center gap-3 px-3 text-left text-app-14 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
            >
              <FolderPlus className="h-5 w-5 shrink-0 text-muted" />
              <span>Add Workspace...</span>
            </button>
          </div>
        )}
      </div>

      {isCreating && (
        <CreateWorkspaceDialog
          onCancel={() => setIsCreating(false)}
          onSubmit={async (name, projectDirectories) => {
            const result = await createWorkspace(name, projectDirectories);
            if (!result.ok) return result.error;
            setIsCreating(false);
            navigate(buildWorkspacePath(result.workspace.id));
            return null;
          }}
        />
      )}

      {menu && menuWorkspace && (
        <WorkspaceContextMenu
          anchor={{ x: menu.x, y: menu.y }}
          workspaceName={menuWorkspace.name}
          deleteBlockedReason={getWorkspaceDeleteBlockedReason(
            threads,
            runningThreadIds,
            menuWorkspace.id,
          )}
          onClose={() => setMenu(null)}
          onRename={() => {
            setMenu(null);
            requestRename(menuWorkspace.id);
          }}
          onDelete={() => {
            setMenu(null);
            requestDelete(menuWorkspace.id);
          }}
        />
      )}

      {actionDialogs}
    </>
  );
}
