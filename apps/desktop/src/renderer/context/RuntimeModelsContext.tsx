import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  createRuntimeModelsStore,
  type RuntimeModelsStore,
} from "../lib/runtimeModelsCache";

const RuntimeModelsContext = createContext<RuntimeModelsStore | null>(null);

export function RuntimeModelsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(
    () =>
      createRuntimeModelsStore({
        listModels: (runtimeId) => window.carrent.runtimes.listModels(runtimeId),
      }),
    [],
  );

  return (
    <RuntimeModelsContext.Provider value={store}>{children}</RuntimeModelsContext.Provider>
  );
}

export function useRuntimeModelsStore() {
  const store = useContext(RuntimeModelsContext);
  if (!store) {
    throw new Error("useRuntimeModelsStore must be used within RuntimeModelsProvider");
  }

  return store;
}
