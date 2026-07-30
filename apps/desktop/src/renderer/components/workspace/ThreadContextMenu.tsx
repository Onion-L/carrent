import { Archive, Copy, ExternalLink, Pencil, Pin } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

const THREAD_MENU_MARGIN = 8;

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-transparent";
const MENU_ITEM_ICON_CLASS = "h-3.5 w-3.5 shrink-0 text-muted";

export function getThreadMenuPosition(
  point: { x: number; y: number },
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = THREAD_MENU_MARGIN,
) {
  return {
    left: Math.min(
      Math.max(point.x, margin),
      Math.max(margin, viewport.width - menuSize.width - margin),
    ),
    top: Math.min(
      Math.max(point.y, margin),
      Math.max(margin, viewport.height - menuSize.height - margin),
    ),
  };
}

export type ThreadContextMenuContentProps = {
  threadTitle: string;
  pinned: boolean;
  sessionId: string | null | undefined;
  archiveBlockedReason: string | null;
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRevealInFinder: () => void;
  onCopySessionId: () => void;
  firstItemRef?: Ref<HTMLButtonElement>;
};

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  title,
  buttonRef,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={MENU_ITEM_CLASS}
    >
      {icon}
      {label}
    </button>
  );
}

export function ThreadContextMenuContent({
  threadTitle,
  pinned,
  sessionId,
  archiveBlockedReason,
  onPin,
  onRename,
  onArchive,
  onRevealInFinder,
  onCopySessionId,
  firstItemRef,
}: ThreadContextMenuContentProps) {
  const sessionTitle =
    sessionId === undefined
      ? "Loading session ID"
      : sessionId === null
        ? "No session ID available"
        : undefined;

  return (
    <div
      data-thread-menu="true"
      role="menu"
      aria-label={`Thread actions for ${threadTitle}`}
      className="w-48 rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
    >
      <MenuItem
        buttonRef={firstItemRef}
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
      <MenuItem
        icon={<Copy className={MENU_ITEM_ICON_CLASS} />}
        label="Copy session ID"
        onClick={onCopySessionId}
        disabled={!sessionId}
        title={sessionTitle}
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
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) {
      return;
    }

    const menuRect = menuRef.current.getBoundingClientRect();
    setPosition(
      getThreadMenuPosition(
        anchor,
        { width: menuRect.width, height: menuRect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-thread-menu="true"]')) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(true);
      }
    };
    const handleViewportChange = () => onClose();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    const frame = window.requestAnimationFrame(() => firstItemRef.current?.focus());

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.cancelAnimationFrame(frame);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{
        left: position?.left ?? -10000,
        top: position?.top ?? -10000,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <ThreadContextMenuContent {...contentProps} firstItemRef={firstItemRef} />
    </div>,
    document.body,
  );
}
