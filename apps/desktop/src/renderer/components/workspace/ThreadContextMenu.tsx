import { AppWindow, Archive, ExternalLink, Pencil, Pin } from "lucide-react";

import { ContextMenuShell, MenuItem } from "./ContextMenu";

const MENU_ITEM_ICON_CLASS = "h-3.5 w-3.5 shrink-0 text-muted";

export type ThreadContextMenuContentProps = {
  threadTitle: string;
  pinned: boolean;
  archiveBlockedReason: string | null;
  onOpenInNewWindow: () => void;
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRevealInFinder: () => void;
};

export function ThreadContextMenuContent({
  threadTitle,
  pinned,
  archiveBlockedReason,
  onOpenInNewWindow,
  onPin,
  onRename,
  onArchive,
  onRevealInFinder,
}: ThreadContextMenuContentProps) {
  return (
    <div
      data-thread-menu="true"
      role="menu"
      aria-label={`Thread actions for ${threadTitle}`}
      className="w-48 rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
    >
      <MenuItem
        icon={<AppWindow className={MENU_ITEM_ICON_CLASS} />}
        label="Open in new window"
        onClick={onOpenInNewWindow}
      />
      <div role="separator" className="mx-2 my-1 border-t border-border" />
      <MenuItem
        icon={<Pin className={MENU_ITEM_ICON_CLASS} />}
        label={pinned ? "Unpin thread" : "Pin thread"}
        onClick={onPin}
      />
      <MenuItem
        icon={<Pencil className={MENU_ITEM_ICON_CLASS} />}
        label="Rename thread"
        onClick={onRename}
      />
      <MenuItem
        icon={<Archive className={MENU_ITEM_ICON_CLASS} />}
        label="Archive thread"
        onClick={onArchive}
        disabled={archiveBlockedReason !== null}
        title={archiveBlockedReason ?? undefined}
      />
      <div role="separator" className="mx-2 my-1 border-t border-border" />
      <MenuItem
        icon={<ExternalLink className={MENU_ITEM_ICON_CLASS} />}
        label="Open in Finder"
        onClick={onRevealInFinder}
      />
    </div>
  );
}

export function ThreadContextMenu({
  anchor,
  onClose,
  ...contentProps
}: ThreadContextMenuContentProps & {
  anchor: { x: number; y: number };
  onClose: (returnFocus?: boolean) => void;
}) {
  return (
    <ContextMenuShell anchor={anchor} onClose={onClose}>
      <ThreadContextMenuContent {...contentProps} />
    </ContextMenuShell>
  );
}
