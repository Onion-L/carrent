import { useCallback, useEffect, useState } from "react";
import { useTerminalPanel } from "../../context/TerminalPanelContext";

export type RightSurface = "chooser" | "browser" | "terminal" | "changes" | "inspector";

export function useRightSurface({
  scopeKey,
  openBrowser,
}: {
  scopeKey: string | null;
  openBrowser: () => void;
}) {
  const [activeSurface, setActiveSurfaceState] = useState<RightSurface | null>(null);
  const {
    isOpen: terminalOpen,
    placement: terminalPlacement,
    openTerminal,
    closeTerminal,
    setSideContainer,
  } = useTerminalPanel();

  useEffect(() => {
    setActiveSurfaceState(null);
    if (terminalOpen && terminalPlacement === "side") closeTerminal();
  }, [scopeKey]);

  useEffect(() => {
    if (activeSurface === "terminal" && (!terminalOpen || terminalPlacement !== "side")) {
      setActiveSurfaceState("chooser");
    }
  }, [activeSurface, terminalOpen, terminalPlacement]);

  const selectSurface = useCallback(
    (surface: RightSurface) => {
      setActiveSurfaceState(surface);
      if (surface !== "terminal" && terminalOpen && terminalPlacement === "side") closeTerminal();
      if (surface === "browser") openBrowser();
      if (surface === "terminal") openTerminal("side");
    },
    [closeTerminal, openBrowser, openTerminal, terminalOpen, terminalPlacement],
  );

  const openRightSurface = () => {
    selectSurface("chooser");
  };

  const closeRightSurface = () => {
    if (terminalOpen && terminalPlacement === "side") closeTerminal();
    setActiveSurfaceState(null);
  };

  return {
    activeSurface,
    selectSurface,
    openRightSurface,
    closeRightSurface,
    setSideContainer,
  };
}
