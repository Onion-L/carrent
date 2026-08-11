import {
  createEmptyAppStateSnapshot,
  normalizeAppStateSnapshotForMemory,
  type AppStateLoadResult,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import type {
  AppStateAuthorityState,
  AppStateCommand,
  AppStateCommandReducer,
  AppStateCommandRejectionReason,
  AppStateCommandResult,
} from "../../src/shared/appStateAuthority";
import type { AppStateStore } from "./appStateStore";

export type {
  AppStateAuthorityState,
  AppStateCommand,
  AppStateCommandRejectionReason,
  AppStateCommandReducer,
  AppStateCommandResult,
} from "../../src/shared/appStateAuthority";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

const DEFAULT_MAX_APPLIED_COMMAND_IDS = 1000;

export type AppStateAuthority = ReturnType<typeof createAppStateAuthority>;

export function createAppStateAuthority(options: {
  store: AppStateStore;
  initialResult: AppStateLoadResult;
  reducers?: Record<string, AppStateCommandReducer>;
  publish: (subscriberId: number, state: AppStateAuthorityState) => void;
  onPersisted?: (snapshot: AppStateSnapshot) => void;
  // Called after an accepted command has been persisted and broadcast, with the
  // command and any data its reducer produced. Lets Main Process services react
  // to an authoritative transition (a committed Thread Draft promotion) without
  // trusting a separate Renderer message for the same fact.
  onCommandAccepted?: (command: AppStateCommand, data: unknown) => void;
  maxAppliedCommandIds?: number;
}) {
  const reducers = options.reducers ?? {};
  const maxAppliedCommandIds = options.maxAppliedCommandIds ?? DEFAULT_MAX_APPLIED_COMMAND_IDS;
  let snapshot: AppStateSnapshot =
    options.initialResult.status === "ready"
      ? options.initialResult.snapshot
      : createEmptyAppStateSnapshot();
  let available = options.initialResult.status === "ready";
  let revision = 0;
  let activeTransactionCount = 0;
  const subscribers = new Set<number>();
  const appliedCommands = new Map<string, number>();
  let queue: Promise<unknown> = Promise.resolve();

  function currentState(): AppStateAuthorityState {
    return { revision, snapshot };
  }

  function rejected(
    reason: AppStateCommandRejectionReason,
    message?: string,
  ): AppStateCommandResult {
    return { status: "rejected", reason, revision, ...(message ? { message } : {}) };
  }

  function rememberCommand(commandId: string) {
    appliedCommands.set(commandId, revision);
    if (appliedCommands.size > maxAppliedCommandIds) {
      const oldest = appliedCommands.keys().next().value;
      if (oldest !== undefined) appliedCommands.delete(oldest);
    }
  }

  function notifyPersisted(next: AppStateSnapshot) {
    try {
      options.onPersisted?.(next);
    } catch {
      // Persistence already succeeded; observers cannot roll it back.
    }
  }

  function notifyCommandAccepted(command: AppStateCommand, data: unknown) {
    try {
      options.onCommandAccepted?.(command, data);
    } catch {
      // The command is already committed; observers cannot roll it back.
    }
  }

  function publishSnapshot(next: AppStateSnapshot, beforePublish?: () => void) {
    snapshot = next;
    revision += 1;
    beforePublish?.();
    notifyPersisted(snapshot);
    const state = currentState();
    for (const subscriberId of subscribers) {
      options.publish(subscriberId, state);
    }
  }

  async function process(command: AppStateCommand): Promise<AppStateCommandResult> {
    if (!available || activeTransactionCount > 0) return rejected("unavailable");
    if (
      typeof command?.commandId !== "string" ||
      command.commandId.length === 0 ||
      typeof command?.type !== "string" ||
      command.type.length === 0
    ) {
      return rejected("invalid", "Malformed App State command.");
    }
    if (appliedCommands.has(command.commandId)) return rejected("duplicate");
    if (command.baseRevision !== undefined && command.baseRevision !== revision) {
      return rejected("stale");
    }
    const reducer = reducers[command.type];
    if (!reducer) return rejected("invalid", `Unknown App State command: ${command.type}`);
    const produced = reducer(snapshot, command.payload);
    if (!produced) return rejected("invalid");
    const next = "snapshot" in produced ? produced.snapshot : produced;
    const data = "snapshot" in produced && produced.data !== undefined ? produced.data : undefined;
    // A reducer returning the input snapshot is a no-op: accept (with any
    // produced data) without persisting or broadcasting.
    if (next === snapshot) {
      rememberCommand(command.commandId);
      notifyCommandAccepted(command, data);
      return { status: "accepted", revision, ...(data !== undefined ? { data } : {}) };
    }
    const normalized = normalizeAppStateSnapshotForMemory(next);
    if (!normalized) return rejected("invalid", "Command produced an invalid App State snapshot.");
    try {
      await options.store.persistAppStateCommand(command, snapshot, normalized);
    } catch (error) {
      return rejected("persistence-failed", String(error));
    }
    publishSnapshot(normalized, () => rememberCommand(command.commandId));
    notifyCommandAccepted(command, data);
    return { status: "accepted", revision, ...(data !== undefined ? { data } : {}) };
  }

  function submit(_subscriberId: number, command: AppStateCommand) {
    const result = queue.then(() => process(command));
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  return {
    getState: currentState,

    subscribe(subscriberId: number): AppStateAuthorityState {
      subscribers.add(subscriberId);
      return currentState();
    },

    unsubscribe(subscriberId: number) {
      subscribers.delete(subscriberId);
    },

    getSubscriberIds(): number[] {
      return [...subscribers];
    },

    submit,

    // Resolves once every command submitted so far has been processed
    // (including its persistence), so quit-time flows can drain the queue.
    waitForIdle(): Promise<unknown> {
      return queue;
    },

    replaceState(result: AppStateLoadResult) {
      if (result.status === "ready") {
        const normalized = normalizeAppStateSnapshotForMemory(result.snapshot);
        if (!normalized) {
          available = false;
          return;
        }
        available = true;
        publishSnapshot(normalized);
      } else {
        available = false;
      }
    },

    // Adopts a snapshot committed outside the command path (Thread deletion
    // and Project relocation transactions) so subscribers converge on what is
    // actually persisted. Bumps the revision and broadcasts like an accepted
    // command. Invalid snapshots are ignored.
    adoptExternalSnapshot(next: AppStateSnapshot) {
      if (!available) return;
      const normalized = normalizeAppStateSnapshotForMemory(next);
      if (!normalized) return;
      publishSnapshot(normalized);
    },

    setTransactionActive(active: boolean) {
      activeTransactionCount = Math.max(0, activeTransactionCount + (active ? 1 : -1));
    },
  };
}

function senderIdOf(event: unknown): number {
  const id = (event as { sender?: { id?: unknown } } | null)?.sender?.id;
  if (typeof id !== "number") throw new Error("Unknown App State command sender.");
  return id;
}

export function registerAppStateAuthorityIpc(
  ipcMainLike: IpcMainLike,
  authority: AppStateAuthority,
) {
  ipcMainLike.handle("app-state:subscribe", (event) => authority.subscribe(senderIdOf(event)));
  ipcMainLike.handle("app-state:unsubscribe", (event) => {
    authority.unsubscribe(senderIdOf(event));
  });
  ipcMainLike.handle("app-state:command", (event, command) =>
    authority.submit(senderIdOf(event), command as AppStateCommand),
  );
}
