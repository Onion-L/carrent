import type { AppStateStore } from "../workspace/appStateStore";
import { readProviderSessions, replaceProviderSessions } from "./providerSessionRepository";
import type { SqliteAppStateLifecycle } from "./sqliteAppStateLifecycle";
import type { SqliteAppStateStore } from "./sqliteAppStateStore";

export type SqliteProductionAppStateStore = AppStateStore &
  Pick<
    SqliteAppStateStore,
    | "deleteAppStateForThreads"
    | "hasCommittedThreadDeletion"
    | "clearCommittedThreadDeletionMarker"
    | "relocateProject"
    | "close"
  >;

export function createSqliteProductionAppStateStore(
  sqlite: SqliteAppStateStore,
  lifecycle: SqliteAppStateLifecycle,
): SqliteProductionAppStateStore {
  return {
    waitForWrites: () => sqlite.waitForIdle(),
    initializeAppState: () => lifecycle.initialize(),
    fullResetAppState: () => lifecycle.fullReset(),
    loadAppStateSnapshot: () => sqlite.loadAppStateSnapshot(),
    saveAppStateSnapshot: (snapshot) => sqlite.saveAppStateSnapshot(snapshot),
    persistAppStateCommand: (command, before, after) =>
      sqlite.persistAppStateCommand(command, before, after),
    loadProviderSessions: async () => ({
      version: 1,
      sessions: await sqlite.run((client) => readProviderSessions(client)),
    }),
    saveProviderSessions: (snapshot) =>
      sqlite.run((client) =>
        client.transaction(() => replaceProviderSessions(client, snapshot.sessions)),
      ),
    deleteAppStateForThreads: (...args) => sqlite.deleteAppStateForThreads(...args),
    hasCommittedThreadDeletion: (operationId) => sqlite.hasCommittedThreadDeletion(operationId),
    clearCommittedThreadDeletionMarker: (operationId) =>
      sqlite.clearCommittedThreadDeletionMarker(operationId),
    relocateProject: (request) => sqlite.relocateProject(request),
    close: () => sqlite.close(),
  };
}
