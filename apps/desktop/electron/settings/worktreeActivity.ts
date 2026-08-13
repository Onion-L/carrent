import { isTerminalSharedChatRunStatus, type SharedChatRunStatus } from "../../src/shared/chat";
import type { AppThreadRecord } from "../../src/shared/workspacePersistence";
import type { WorktreeActivitySnapshot } from "../../src/shared/worktrees";

/**
 * Builds the Worktree activity snapshot from Main Process authority state.
 * A Run is live while its status is starting, running, waiting-for-approval,
 * or waiting-for-answer; terminal statuses (completed, failed, cancelled)
 * never block cleanup. Runs whose Thread has no Project record are ignored.
 */
export function buildWorktreeActivitySnapshot(input: {
  threads: AppThreadRecord[];
  runs: Array<{ threadId: string; status: SharedChatRunStatus }>;
  runningTerminalTabs: WorktreeActivitySnapshot["runningTerminalTabs"];
}): WorktreeActivitySnapshot {
  const projectIdByThreadId = new Map(input.threads.map((thread) => [thread.id, thread.projectId]));
  const liveRunProjectIds = new Set<string>();
  for (const run of input.runs) {
    if (isTerminalSharedChatRunStatus(run.status)) continue;
    const projectId = projectIdByThreadId.get(run.threadId);
    if (projectId !== undefined) liveRunProjectIds.add(projectId);
  }
  return {
    liveRunProjectIds: [...liveRunProjectIds],
    runningTerminalTabs: input.runningTerminalTabs,
  };
}
