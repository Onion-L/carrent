import type {
  AppStateAuthorityState,
  AppStateCommand,
  AppStateCommandResult,
} from "../../shared/appStateAuthority";
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
      const next = reducer?.(snapshot, command.payload);
      const normalized = next ? normalizeAppStateSnapshotForWrite(next) : null;
      if (!normalized) return { status: "rejected", reason: "invalid", revision };
      snapshot = normalized;
      revision += 1;
      options.onPersist?.(structuredClone(normalized));
      broadcast();
      return { status: "accepted", revision };
    },
    // Mirrors the legacy `app-state:save` path: the snapshot is persisted and
    // adopted by the authority, which broadcasts it to every subscriber.
    adoptExternalSnapshot: (next: AppStateSnapshot) => {
      snapshot = structuredClone(next);
      revision += 1;
      options.onPersist?.(structuredClone(snapshot));
      broadcast();
    },
    // Mirrors the Main-process Thread deletion transaction: persists directly
    // to the store WITHOUT adopting, leaving the authority's in-memory state
    // (and subscribers) untouched.
    persistExternally: (next: AppStateSnapshot) => {
      options.onPersist?.(structuredClone(next));
    },
  };
}

export type FakeAppStateAuthority = ReturnType<typeof createFakeAppStateAuthority>;
