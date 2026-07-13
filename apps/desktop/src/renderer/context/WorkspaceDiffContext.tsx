import { createContext, useContext, useState, type ReactNode } from "react";
import type { ChangedFile } from "../mock/uiShellData";
import type { WorkspaceDiffSnapshot } from "../components/chat/WorkspaceDiffViewer";

type WorkspaceDiffState =
  | {
      open: true;
      snapshot: WorkspaceDiffSnapshot;
      files: ChangedFile[];
    }
  | { open: false };

export type WorkspaceDiffContextValue = {
  state: WorkspaceDiffState;
  openDiff: (snapshot: WorkspaceDiffSnapshot, files: ChangedFile[]) => void;
  closeDiff: () => void;
};

const WorkspaceDiffContext = createContext<WorkspaceDiffContextValue>({
  state: { open: false },
  openDiff: () => {},
  closeDiff: () => {},
});

export function WorkspaceDiffProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceDiffState>({ open: false });

  const openDiff = (snapshot: WorkspaceDiffSnapshot, files: ChangedFile[]) => {
    setState({ open: true, snapshot, files });
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

export function useWorkspaceDiff(): WorkspaceDiffContextValue {
  return useContext(WorkspaceDiffContext);
}
