import type { LocalPathContextItem, RevealPathResult } from "../../shared/localPathContext";

// Dependencies injected so the reveal flow is testable without the Electron
// bridge or the toast system: tests pass fakes, production binds them through
// useRevealLocalPathContext.
export type RevealLocalPathContextDeps = {
  revealPath: (path: string) => Promise<RevealPathResult>;
  showError: (message: string) => void;
};

// Single implementation of the Local Path Context reveal flow shared by the
// Composer card and the sent-message badge: the privileged handler reports a
// missing path, and any bridge failure surfaces as one concise toast instead
// of throwing to the click handler.
export async function revealLocalPathContext(
  item: Pick<LocalPathContextItem, "path" | "basename">,
  { revealPath, showError }: RevealLocalPathContextDeps,
): Promise<void> {
  try {
    const result = await revealPath(item.path);
    if (!result.revealed) {
      showError(`Could not reveal “${item.basename}”: the path no longer exists.`);
    }
  } catch {
    showError(`Could not reveal “${item.basename}” in the file manager.`);
  }
}
