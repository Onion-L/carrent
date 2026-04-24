import { createContext, useContext, useState, type ReactNode } from "react";

export type ActiveThreadContextValue = {
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
};

const ActiveThreadContext = createContext<ActiveThreadContextValue>({
  activeThreadId: null,
  setActiveThreadId: () => {},
});

export function ActiveThreadProvider({
  children,
  initialThreadId,
}: {
  children: ReactNode;
  initialThreadId?: string | null;
}) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId ?? null,
  );

  return (
    <ActiveThreadContext.Provider value={{ activeThreadId, setActiveThreadId }}>
      {children}
    </ActiveThreadContext.Provider>
  );
}

export function useActiveThread() {
  return useContext(ActiveThreadContext);
}
