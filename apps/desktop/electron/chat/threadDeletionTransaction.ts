import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  DeleteThreadDataRequest,
  ThreadDataDeletionReceipt,
  ThreadDeletionTransactionRequest,
} from "../../src/shared/chat";
import { applyThreadDeletionToAppState } from "../../src/shared/chat";
import type {
  AppStateSnapshot,
  ProviderSessionSnapshot,
} from "../../src/shared/workspacePersistence";

export type ThreadDeletionJournal = {
  version: 1;
  operationId: string;
  phase: "preparing" | "committed";
  request: ThreadDeletionTransactionRequest;
  removedProviderSessions: Record<string, string>;
};

export type ThreadDeletionJournalStore = {
  load: () => Promise<ThreadDeletionJournal | null>;
  save: (journal: ThreadDeletionJournal) => Promise<void>;
  clear: () => Promise<void>;
};

type TransactionAppStateStore = {
  waitForWrites: () => Promise<void>;
  loadAppStateSnapshot: () => Promise<AppStateSnapshot | null>;
  loadProviderSessions: () => Promise<ProviderSessionSnapshot>;
  saveProviderSessions: (snapshot: ProviderSessionSnapshot) => Promise<void>;
  saveAppStateSnapshot: (snapshot: AppStateSnapshot) => Promise<void>;
};

type TransactionAttachmentStore = {
  prepareDeletion: (operationId: string, storageKeys: string[]) => Promise<void>;
  commitDeletion: (operationId: string) => Promise<void>;
  rollbackDeletion: (operationId: string) => Promise<void>;
};

type TransactionSessionManager = {
  deleteThreadData: (request: DeleteThreadDataRequest) => Promise<ThreadDataDeletionReceipt | void>;
  rollbackThreadDataDeletion: (receipt: ThreadDataDeletionReceipt) => Promise<void>;
};

function removedProviderSessions(
  snapshot: ProviderSessionSnapshot,
  threadIds: string[],
): Record<string, string> {
  const suffixes = threadIds.map((threadId) => `:${threadId}`);
  return Object.fromEntries(
    Object.entries(snapshot.sessions).filter(([key]) =>
      suffixes.some((suffix) => key.endsWith(suffix)),
    ),
  );
}

async function retryTwice(operation: () => Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function createThreadDeletionJournalStore(baseDir: string): ThreadDeletionJournalStore {
  const journalPath = join(baseDir, "thread-deletion-journal.json");

  return {
    async load() {
      try {
        return JSON.parse(await readFile(journalPath, "utf-8")) as ThreadDeletionJournal;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(journal) {
      await mkdir(baseDir, { recursive: true });
      const temporaryPath = `${journalPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporaryPath, JSON.stringify(journal, null, 2), "utf-8");
      await rename(temporaryPath, journalPath);
    },
    async clear() {
      await rm(journalPath, { force: true });
    },
  };
}

async function restorePreparingTransaction(options: {
  journal: ThreadDeletionJournal;
  journalStore: ThreadDeletionJournalStore;
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const rollbackErrors: unknown[] = [];
  const { journal } = options;
  const operations = [
    () => options.appStateStore.saveAppStateSnapshot(journal.request.beforeAppState),
    async () => {
      const current = await options.appStateStore.loadProviderSessions();
      await options.appStateStore.saveProviderSessions({
        version: 1,
        sessions: { ...current.sessions, ...journal.removedProviderSessions },
      });
    },
    () => options.attachmentStore.rollbackDeletion(journal.operationId),
  ];
  for (const operation of operations) {
    try {
      await retryTwice(operation);
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(rollbackErrors, "Thread deletion recovery could not roll back.");
  }
  await options.journalStore.clear();
}

async function finishCommittedTransaction(options: {
  journal: ThreadDeletionJournal;
  journalStore: ThreadDeletionJournalStore;
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const { journal } = options;
  await retryTwice(async () => {
    await options.attachmentStore.commitDeletion(journal.operationId);
    await options.journalStore.clear();
  });
}

export async function recoverThreadDeletionTransaction(options: {
  journalStore: ThreadDeletionJournalStore;
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const journal = await options.journalStore.load();
  if (!journal) return;
  if (journal.phase === "committed") {
    await finishCommittedTransaction({ ...options, journal });
    return;
  }
  await restorePreparingTransaction({ ...options, journal });
}

export function createThreadDeletionTransactionManager(options: {
  journalStore: ThreadDeletionJournalStore;
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
  sessionManager: TransactionSessionManager;
  createOperationId?: () => string;
  onActiveChange?: (active: boolean) => void;
}) {
  let queue = Promise.resolve();

  const runExclusive = <T>(operation: () => Promise<T>) => {
    const result = queue.catch(() => {}).then(operation);
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  return {
    deleteThread: (request: ThreadDeletionTransactionRequest) =>
      runExclusive(async () => {
        options.onActiveChange?.(true);
        let recoveryPending = false;
        try {
          await options.appStateStore.waitForWrites();
          try {
            await recoverThreadDeletionTransaction(options);
          } catch (error) {
            recoveryPending = true;
            throw error;
          }
          if (await options.journalStore.load()) {
            recoveryPending = true;
            throw new Error("Previous Thread attachment cleanup is still pending.");
          }
          const beforeAppState = await options.appStateStore.loadAppStateSnapshot();
          if (!beforeAppState) {
            throw new Error("Thread deletion requires persisted App State.");
          }
          const afterAppState = applyThreadDeletionToAppState(
            beforeAppState,
            request.threadData.threadIds,
            request.scope,
          );
          const transactionRequest: ThreadDeletionTransactionRequest = {
            ...request,
            beforeAppState,
            afterAppState,
          };
          const providerSnapshot = await options.appStateStore.loadProviderSessions();
          const journal: ThreadDeletionJournal = {
            version: 1,
            operationId: options.createOperationId?.() ?? randomUUID(),
            phase: "preparing",
            request: transactionRequest,
            removedProviderSessions: removedProviderSessions(
              providerSnapshot,
              transactionRequest.threadData.threadIds,
            ),
          };
          await options.journalStore.save(journal);
          recoveryPending = true;

          let receipt: ThreadDataDeletionReceipt | null = null;
          try {
            await options.attachmentStore.prepareDeletion(
              journal.operationId,
              transactionRequest.threadData.attachmentStorageKeys,
            );
            const deletionReceipt =
              transactionRequest.threadData.threadIds.length > 0
                ? await options.sessionManager.deleteThreadData({
                    ...transactionRequest.threadData,
                    attachmentStorageKeys: [],
                  })
                : undefined;
            receipt = deletionReceipt ?? {
              threadIds: transactionRequest.threadData.threadIds,
              removedProviderSessions: journal.removedProviderSessions,
              detachedRuntimeSessions: {},
            };
            await options.appStateStore.saveAppStateSnapshot(transactionRequest.afterAppState);
            await options.journalStore.save({ ...journal, phase: "committed" });
          } catch (error) {
            const rollbackErrors: unknown[] = [];
            const operations = [
              () => options.appStateStore.saveAppStateSnapshot(transactionRequest.beforeAppState),
              ...(receipt
                ? [() => options.sessionManager.rollbackThreadDataDeletion(receipt!)]
                : []),
              () => options.attachmentStore.rollbackDeletion(journal.operationId),
            ];
            for (const operation of operations) {
              try {
                await retryTwice(operation);
              } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
              }
            }
            if (rollbackErrors.length > 0) {
              throw new AggregateError(
                [error, ...rollbackErrors],
                "Thread deletion failed and could not be fully rolled back.",
              );
            }
            await options.journalStore.clear();
            recoveryPending = false;
            throw error;
          }

          try {
            await finishCommittedTransaction({ ...options, journal });
            recoveryPending = false;
          } catch {
            // The snapshots are committed. Keep the journal for cleanup retry,
            // but release the transaction lock so normal writes can continue.
            recoveryPending = false;
          }
        } finally {
          if (!recoveryPending) {
            options.onActiveChange?.(false);
          }
        }
      }),
    waitForIdle: () => queue,
  };
}
