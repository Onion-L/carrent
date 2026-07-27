import type { ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "../workspace/workspaceStore";
import type { ProviderSessionStore } from "./chatSessionManager";
import {
  isInconsistentProviderSessionKey,
} from "../../src/shared/providerSessions";
import { runtimeIds, type RuntimeId } from "../../src/shared/runtimes";

export function createPersistentProviderSessionStore(
  store: Pick<WorkspaceStore, "saveProviderSessions">,
  snapshot: ProviderSessionSnapshot,
): ProviderSessionStore {
  let sessions = { ...snapshot.sessions };
  const invalidRequests = new Set<string>();
  let writeQueue = Promise.resolve();

  const enqueueWrite = <T>(write: () => Promise<T>) => {
    const nextWrite = writeQueue.catch(() => {}).then(write);
    writeQueue = nextWrite.then(
      () => {},
      () => {},
    );
    return nextWrite;
  };

  const detachInvalid = (requestKey: string, storedKey: string) => {
    delete sessions[storedKey];
    invalidRequests.add(requestKey);
    void enqueueWrite(async () => {
      await store.saveProviderSessions({ version: 1, sessions: { ...sessions } });
    }).catch(() => {
      // The invalid entry stays detached in memory; a later write can persist the repair.
    });
  };

  return {
    get: (key) => {
      const sessionId = sessions[key];
      if (sessionId !== undefined) {
        if (sessionId.trim().length === 0) {
          detachInvalid(key, key);
          return undefined;
        }
        return sessionId;
      }

      const separator = key.indexOf(":");
      const runtimeId = key.slice(0, separator) as RuntimeId;
      const threadId = key.slice(separator + 1);
      const inconsistentKey = Object.keys(sessions).find(
        (storedKey) =>
          runtimeIds.includes(runtimeId) &&
          isInconsistentProviderSessionKey(storedKey, runtimeId, threadId),
      );
      if (inconsistentKey) {
        detachInvalid(key, inconsistentKey);
      }
      return undefined;
    },
    consumeInvalidMappingNotice: (key) => invalidRequests.delete(key),
    set: (key, sessionId) =>
      enqueueWrite(async () => {
        const nextSessions = { ...sessions, [key]: sessionId };
        await store.saveProviderSessions({ version: 1, sessions: nextSessions });
        sessions = nextSessions;
      }),
    delete: (key, sessionId) =>
      enqueueWrite(async () => {
        if (sessionId && sessions[key] !== sessionId) {
          return;
        }

        const nextSessions = { ...sessions };
        delete nextSessions[key];
        await store.saveProviderSessions({ version: 1, sessions: nextSessions });
        sessions = nextSessions;
      }),
    deleteThreads: (threadIds) =>
      enqueueWrite(async () => {
        const suffixes = [...new Set(threadIds)].map((threadId) => `:${threadId}`);
        const removedSessions = Object.fromEntries(
          Object.entries(sessions).filter(([key]) =>
            suffixes.some((suffix) => key.endsWith(suffix)),
          ),
        );
        const nextSessions = Object.fromEntries(
          Object.entries(sessions).filter(
            ([key]) => !suffixes.some((suffix) => key.endsWith(suffix)),
          ),
        );
        await store.saveProviderSessions({ version: 1, sessions: nextSessions });
        sessions = nextSessions;
        return removedSessions;
      }),
    restoreThreads: (restoredSessions) =>
      enqueueWrite(async () => {
        const nextSessions = { ...sessions, ...restoredSessions };
        await store.saveProviderSessions({ version: 1, sessions: nextSessions });
        sessions = nextSessions;
      }),
  };
}
