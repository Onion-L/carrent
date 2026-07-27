import { useAppState } from "../../context/AppStateContext";

export function WorkspaceNavigationPane() {
  const { workspaces, activeWorkspaceId } = useAppState();
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar px-3 py-3">
      <h2 className="truncate text-app-13 font-semibold text-fg">{workspace?.name}</h2>
      <p className="mt-4 text-app-12 text-subtle">No Projects</p>
    </aside>
  );
}
