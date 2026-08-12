import { createContext, useContext, useState, type ReactNode } from "react";
import type { ChangedFile } from "../../shared/threadContent";
import type { WorkspaceDiffSnapshot } from "../components/chat/WorkspaceDiffViewer";

type WorkspaceDiffState =
  | {
      open: true;
      scopeKey: string;
      snapshot: WorkspaceDiffSnapshot;
      files: ChangedFile[];
    }
  | { open: false };

export type WorkspaceDiffContextValue = {
  state: WorkspaceDiffState;
  openDiff: (scopeKey: string, snapshot: WorkspaceDiffSnapshot, files: ChangedFile[]) => void;
  closeDiff: () => void;
};

const WorkspaceDiffContext = createContext<WorkspaceDiffContextValue>({
  state: { open: false },
  openDiff: () => {},
  closeDiff: () => {},
});

export function WorkspaceDiffProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceDiffState>({ open: false });

  const openDiff = (scopeKey: string, snapshot: WorkspaceDiffSnapshot, files: ChangedFile[]) => {
    setState({ open: true, scopeKey, snapshot, files });
  };

  const closeDiff = () => {
    setState({ open: false });
  };

  return (
    <WorkspaceDiffContext.Provider value={{ state, openDiff, closeDiff }}>
      {children}
    </WorkspaceDiffContext.Provider>
  );
}

export function useThreadContentDiff(): WorkspaceDiffContextValue {
  return useContext(WorkspaceDiffContext);
}
