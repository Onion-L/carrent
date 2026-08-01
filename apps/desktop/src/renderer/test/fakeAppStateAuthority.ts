import type {
  AppStateAuthorityState,
  AppStateCommand,
  AppStateCommandResult,
} from "../../shared/appStateAuthority";
import {
  applyThreadDeletionToAppState,
  type ThreadDeletionTransactionRequest,
} from "../../shared/chat";
import {
  normalizeAppStateSnapshotForWrite,
  type AppStateSnapshot,
} from "../../shared/workspacePersistence";
import { appStateCommandReducers } from "../../../electron/workspace/appStateCommands";

// In-memory stand-in for the Main-process App State authority. Commands run
// through the real reducers and snapshot normalizer; accepted commands and
// adopted external saves bump the revision and synchronously notify onChanged
// listeners, mirroring the `app-state:changed` broadcast.
export function createFakeAppStateAuthority(
  initialSnapshot: AppStateSnapshot,
  options: {
    onPersist?: (snapshot: AppStateSnapshot) => void;
    // Runs before a command is applied; returning a result short-circuits the
    // command (used to simulate persistence failures and slow saves).
    commandHook?: (command: AppStateCommand) => Promise<AppStateCommandResult | null>;
  } = {},
) {
  let snapshot = structuredClone(initialSnapshot);
  let revision = 0;
  const listeners = new Set<(state: AppStateAuthorityState) => void>();

  const broadcast = () => {
    const state: AppStateAuthorityState = {
      revision,
      snapshot: structuredClone(snapshot),
    };
    for (const listener of listeners) listener(state);
  };

  return {
    getState: (): AppStateAuthorityState => ({ revision, snapshot: structuredClone(snapshot) }),
    subscribe: async (): Promise<AppStateAuthorityState> => ({
      revision,
      snapshot: structuredClone(snapshot),
    }),
    unsubscribe: async () => {},
    onChanged: (listener: (state: AppStateAuthorityState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    command: async (command: AppStateCommand): Promise<AppStateCommandResult> => {
      const hooked = await options.commandHook?.(command);
      if (hooked) return hooked;
      if (command.baseRevision !== undefined && command.baseRevision !== revision) {
        return { status: "rejected", reason: "stale", revision };
      }
      const reducer = appStateCommandReducers[command.type];
      const produced = reducer?.(snapshot, command.payload);
      if (!produced) return { status: "rejected", reason: "invalid", revision };
      const next = "snapshot" in produced ? produced.snapshot : produced;
      const data =
        "snapshot" in produced && produced.data !== undefined ? produced.data : undefined;
      if (next === snapshot) {
        return { status: "accepted", revision, ...(data !== undefined ? { data } : {}) };
      }
      const normalized = normalizeAppStateSnapshotForWrite(next);
      if (!normalized) return { status: "rejected", reason: "invalid", revision };
      snapshot = normalized;
      revision += 1;
      options.onPersist?.(structuredClone(normalized));
      broadcast();
      return { status: "accepted", revision, ...(data !== undefined ? { data } : {}) };
    },
    // Mirrors snapshots committed outside the command path (Thread deletion
    // and Project relocation transactions, rereads, resets): persisted and
    // adopted by the authority, which broadcasts to every subscriber.
    adoptExternalSnapshot: (next: AppStateSnapshot) => {
      snapshot = structuredClone(next);
      revision += 1;
      options.onPersist?.(structuredClone(snapshot));
      broadcast();
    },
    // Recomputes and commits a Thread deletion transaction the way the Main
    // process does, then adopts the committed snapshot.
    commitThreadDeletion: (request: ThreadDeletionTransactionRequest) => {
      const afterAppState = applyThreadDeletionToAppState(
        snapshot,
        request.threadData.threadIds,
        request.scope,
      );
      snapshot = afterAppState;
      revision += 1;
      options.onPersist?.(structuredClone(snapshot));
      broadcast();
    },
  };
}

export type FakeAppStateAuthority = ReturnType<typeof createFakeAppStateAuthority>;
