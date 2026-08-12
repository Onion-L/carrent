import { createContext, useContext } from "react";

export type TerminalPlacement = "bottom" | "side";

type TerminalPanelContextValue = {
  isOpen: boolean;
  placement: TerminalPlacement;
  openTerminal: (placement: TerminalPlacement) => void;
  closeTerminal: () => void;
  setSideContainer: (container: HTMLElement | null) => void;
};

const TerminalPanelContext = createContext<TerminalPanelContextValue>({
  isOpen: false,
  placement: "bottom",
  openTerminal: () => {},
  closeTerminal: () => {},
  setSideContainer: () => {},
});

export function TerminalPanelProvider({
  value,
  children,
}: {
  value: TerminalPanelContextValue;
  children: React.ReactNode;
}) {
  return <TerminalPanelContext.Provider value={value}>{children}</TerminalPanelContext.Provider>;
}

export function useTerminalPanel() {
  return useContext(TerminalPanelContext);
}
