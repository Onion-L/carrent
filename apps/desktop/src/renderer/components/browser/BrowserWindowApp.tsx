import { useEffect } from "react";
import { BrowserWorkspace, useBrowserThread } from "./BrowserWorkspace";

export function BrowserWindowApp() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("projectId");
  const threadId = params.get("threadId");
  const target = projectId && threadId ? { projectId, threadId } : null;
  const { state, setState, open } = useBrowserThread(target);

  useEffect(() => {
    if (target && state && !state.open) void open();
  }, [open, state?.open, target?.projectId, target?.threadId]);

  if (!target || !state) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-app-13 text-muted">
        Loading browser...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-bg text-fg">
      <BrowserWorkspace target={target} state={state} setState={setState} visible standalone />
    </div>
  );
}
