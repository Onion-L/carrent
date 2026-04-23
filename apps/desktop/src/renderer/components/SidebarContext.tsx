import { createContext, useContext } from "react";

interface SidebarContextValue {
  toggle: () => void;
  isCollapsed: boolean;
}

export const SidebarContext = createContext<SidebarContextValue>({
  toggle: () => {},
  isCollapsed: false,
});

export function useSidebar() {
  return useContext(SidebarContext);
}
