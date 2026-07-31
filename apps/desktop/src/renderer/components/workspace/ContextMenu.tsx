import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

const MENU_MARGIN = 8;

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-transparent";

export function getMenuPosition(
  point: { x: number; y: number },
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = MENU_MARGIN,
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

export function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  title,
  danger,
  buttonRef,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
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
      className={`${MENU_ITEM_CLASS} ${danger ? "text-danger" : "text-fg"}`}
    >
      {icon}
      {label}
    </button>
  );
}

export function ContextMenuShell({
  anchor,
  onClose,
  children,
}: {
  anchor: { x: number; y: number };
  onClose: (returnFocus?: boolean) => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) {
      return;
    }

    const menuRect = menuRef.current.getBoundingClientRect();
    setPosition(
      getMenuPosition(
        anchor,
        { width: menuRect.width, height: menuRect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !menuRef.current?.contains(target)) {
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
    const frame = window.requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
    );

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
      {children}
    </div>,
    document.body,
  );
}
