import type { ThreadRecord } from "../mock/uiShellData";

export function splitProjectThreads(threads: ThreadRecord[]) {
  const archived = threads.filter((thread) => thread.archived);
  const active = threads.filter((thread) => !thread.archived);
  const pinned = active.filter((thread) => thread.pinned);
  const regular = active.filter((thread) => !thread.pinned);

  return {
    active: [...pinned, ...regular],
    archived,
  };
}
