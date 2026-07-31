import type { AppStateSnapshot } from "./workspacePersistence";

// Command/subscription contract shared by the Main-process App State
// authority, the preload bridge, and renderer clients.

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
