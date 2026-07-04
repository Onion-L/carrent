import type { ThreadRecord } from "../mock/uiShellData";

export function splitProjectThreads(threads: ThreadRecord[]) {
  const visible = threads.filter((thread) => !thread.draft);
  const archived = visible.filter((thread) => thread.archived);
  const active = visible.filter((thread) => !thread.archived);
  const pinned = active.filter((thread) => thread.pinned);
  const regular = active.filter((thread) => !thread.pinned);

  return {
    active: [...pinned, ...regular],
    archived,
  };
}
