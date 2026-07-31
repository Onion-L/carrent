import { Pencil, Trash2 } from "lucide-react";

import { ContextMenuShell, MenuItem } from "./ContextMenu";

export type WorkspaceContextMenuContentProps = {
  workspaceName: string;
  deleteBlockedReason: string | null;
  onRename: () => void;
  onDelete: () => void;
};

export function WorkspaceContextMenuContent({
  workspaceName,
  deleteBlockedReason,
  onRename,
  onDelete,
}: WorkspaceContextMenuContentProps) {
  return (
    <div
      data-workspace-menu="true"
      role="menu"
      aria-label={`Workspace actions for ${workspaceName}`}
      className="w-48 rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
    >
      <MenuItem
        icon={<Pencil className="h-3.5 w-3.5 shrink-0 text-muted" />}
        label="Rename Workspace"
        onClick={onRename}
      />
      <div role="separator" className="mx-2 my-1 border-t border-border" />
      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5 shrink-0 text-danger" />}
        label="Delete Workspace"
        onClick={onDelete}
        disabled={deleteBlockedReason !== null}
        title={deleteBlockedReason ?? undefined}
        danger
      />
    </div>
  );
}

export function WorkspaceContextMenu({
  anchor,
  onClose,
  ...contentProps
}: WorkspaceContextMenuContentProps & {
  anchor: { x: number; y: number };
  onClose: (returnFocus?: boolean) => void;
}) {
  return (
    <ContextMenuShell anchor={anchor} onClose={onClose}>
      <WorkspaceContextMenuContent {...contentProps} />
    </ContextMenuShell>
  );
}
