import type { ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "../workspace/workspaceStore";
import type { ProviderSessionStore } from "./chatSessionManager";

export function createPersistentProviderSessionStore(
  store: Pick<WorkspaceStore, "saveProviderSessions">,
  snapshot: ProviderSessionSnapshot,
): ProviderSessionStore {
  let sessions = { ...snapshot.sessions };
  let writeQueue = Promise.resolve();

  const enqueueWrite = (write: () => Promise<void>) => {
    const nextWrite = writeQueue.catch(() => {}).then(write);
    writeQueue = nextWrite.then(
      () => {},
      () => {},
    );
    return nextWrite;
  };

  return {
    get: (key) => sessions[key],
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
  };
}
