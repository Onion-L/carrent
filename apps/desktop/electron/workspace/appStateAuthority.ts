import {
  createEmptyAppStateSnapshot,
  normalizeAppStateSnapshotForWrite,
  type AppStateLoadResult,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import type { AppStateStore } from "./appStateStore";

export type AppStateCommand = {
  commandId: string;
  type: string;
  payload?: unknown;
  baseRevision?: number;
};

export type AppStateCommandRejectionReason =
  | "duplicate"
  | "stale"
  | "invalid"
  | "unavailable"
  | "persistence-failed";

export type AppStateCommandResult =
  | { status: "accepted"; revision: number }
  | {
      status: "rejected";
      reason: AppStateCommandRejectionReason;
      revision: number;
      message?: string;
    };

export type AppStateAuthorityState = {
  revision: number;
  snapshot: AppStateSnapshot;
};

export type AppStateCommandReducer = (
  snapshot: AppStateSnapshot,
  payload: unknown,
) => AppStateSnapshot | null;

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
  let transactionActive = false;
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

  async function process(command: AppStateCommand): Promise<AppStateCommandResult> {
    if (!available || transactionActive) return rejected("unavailable");
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
    const next = reducer(snapshot, command.payload);
    if (!next) return rejected("invalid");
    const normalized = normalizeAppStateSnapshotForWrite(next);
    if (!normalized) return rejected("invalid", "Command produced an invalid App State snapshot.");
    try {
      await options.store.saveAppStateSnapshot(normalized);
    } catch (error) {
      return rejected("persistence-failed", String(error));
    }
    snapshot = normalized;
    revision += 1;
    rememberCommand(command.commandId);
    const state = currentState();
    for (const subscriberId of subscribers) {
      options.publish(subscriberId, state);
    }
    return { status: "accepted", revision };
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

    submit,

    replaceState(result: AppStateLoadResult) {
      if (result.status === "ready") {
        snapshot = result.snapshot;
        available = true;
      } else {
        available = false;
      }
    },

    setTransactionActive(active: boolean) {
      transactionActive = active;
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
