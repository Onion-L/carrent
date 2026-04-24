import { useWorkspace } from "./WorkspaceContext";

export type ActiveThreadContextValue = Pick<
  ReturnType<typeof useWorkspace>,
  "activeThreadId" | "setActiveThreadId"
>;

export function useActiveThread(): ActiveThreadContextValue {
  const { activeThreadId, setActiveThreadId } = useWorkspace();

  return {
    activeThreadId,
    setActiveThreadId,
  };
}
