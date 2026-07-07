import type { ThreadRecord } from "../mock/uiShellData";

export function splitProjectThreads(threads: ThreadRecord[]) {
  const visible = threads.filter((thread) => !thread.draft);
  const pinned = visible.filter((thread) => thread.pinned);
  const regular = visible.filter((thread) => !thread.pinned);

  return {
    active: [...pinned, ...regular],
  };
}
