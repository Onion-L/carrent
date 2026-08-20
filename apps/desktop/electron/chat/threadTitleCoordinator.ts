import type { AppStateCommand, AppStateCommandResult } from "../../src/shared/appStateAuthority";
import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";

export type ThreadTitlePromotion = {
  threadId: string;
  runId: string;
  source: string;
};

export function registerAcceptedThreadTitlePromotion(
  registrar: { registerPromotion: (promotion: ThreadTitlePromotion) => void } | null | undefined,
  command: AppStateCommand,
  data: unknown,
) {
  if (!registrar || command.type !== "thread-draft:promote") return;
  const created = (data as { created?: unknown } | undefined)?.created;
  const payload = command.payload as
    | { threadId?: unknown; titleSource?: unknown; run?: { id?: unknown } }
    | undefined;
  if (
    created !== true ||
    typeof payload?.threadId !== "string" ||
    typeof payload.run?.id !== "string" ||
    typeof payload.titleSource !== "string"
  ) {
    return;
  }
  registrar.registerPromotion({
    threadId: payload.threadId,
    runId: payload.run.id,
    source: payload.titleSource,
  });
}

export function createThreadTitleCoordinator(_options: {
  getSnapshot: () => AppStateSnapshot;
  submitCommand: (command: AppStateCommand) => Promise<AppStateCommandResult>;
}) {
  const promotions = new Map<string, ThreadTitlePromotion>();
  return {
    registerPromotion(promotion: ThreadTitlePromotion) {
      promotions.set(`${promotion.threadId}:${promotion.runId}`, promotion);
    },
    enqueue(input: { threadId: string; runId: string }) {
      promotions.delete(`${input.threadId}:${input.runId}`);
    },
    reconcile(snapshot: AppStateSnapshot) {
      const threadIds = new Set((snapshot.threads ?? []).map((thread) => thread.id));
      for (const [key, promotion] of promotions) {
        if (!threadIds.has(promotion.threadId)) promotions.delete(key);
      }
    },
    waitForIdle: async () => {},
    shutdown: async () => promotions.clear(),
  };
}

export type ThreadTitleCoordinator = ReturnType<typeof createThreadTitleCoordinator>;
