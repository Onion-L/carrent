import { useCallback } from "react";

import type { LocalPathContextItem } from "../../shared/localPathContext";
import { useToast } from "../components/toast/ToastContext";
import { revealLocalPathContext } from "../lib/revealLocalPathContext";

// Binds the shared Local Path Context reveal flow to the production Electron
// bridge and toast system. The behavior itself lives in
// revealLocalPathContext, which tests cover directly.
export function useRevealLocalPathContext() {
  const { showToast } = useToast();
  return useCallback(
    (item: LocalPathContextItem) =>
      revealLocalPathContext(item, {
        revealPath: (path) => window.carrent.shell.revealPath(path),
        showError: (message) => showToast(message, "error"),
      }),
    [showToast],
  );
}
