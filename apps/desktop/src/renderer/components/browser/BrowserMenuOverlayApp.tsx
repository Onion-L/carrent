import { useEffect, useState } from "react";
import type { BrowserMenuOverlayState } from "../../../shared/browser";
import { BrowserMenuContent } from "./BrowserMenuContent";

export function BrowserMenuOverlayApp() {
  const [state, setState] = useState<BrowserMenuOverlayState | null>(null);

  useEffect(() => {
    const unsubscribe = window.browserMenuOverlay.onState((next) => {
      document.documentElement.dataset.theme = next.theme;
      setState(next);
    });
    void window.browserMenuOverlay.ready();
    return unsubscribe;
  }, []);

  if (!state) return null;

  return (
    <BrowserMenuContent
      state={state}
      onAction={(action) => void window.browserMenuOverlay.action({ token: state.token, action })}
    />
  );
}
