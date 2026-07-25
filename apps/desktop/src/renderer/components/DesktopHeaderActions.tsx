import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const DESKTOP_HEADER_ACTIONS_ID = "desktop-header-actions";

export function DesktopHeaderActionsSlot() {
  return <div id={DESKTOP_HEADER_ACTIONS_ID} className="flex h-full items-center gap-1" />;
}

export function DesktopHeaderPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(DESKTOP_HEADER_ACTIONS_ID));
  }, []);

  if (typeof document === "undefined") {
    return <>{children}</>;
  }

  return target ? createPortal(children, target) : null;
}
