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
  | { status: "accepted"; revision: number; data?: unknown }
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

/**
 * Reducers return the next snapshot, or null to reject the command as
 * invalid. The `{ snapshot, data }` form attaches a reducer-produced result
 * (e.g. the get-or-created draft) to the accepted command result. Returning
 * the input snapshot reference is a no-op: the command is accepted (with any
 * data) without persisting, bumping the revision, or broadcasting.
 */
export type AppStateCommandReducerResult =
  | AppStateSnapshot
  | { snapshot: AppStateSnapshot; data?: unknown };

export type AppStateCommandReducer = (
  snapshot: AppStateSnapshot,
  payload: unknown,
) => AppStateCommandReducerResult | null;
