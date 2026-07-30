import { describe, expect, it } from "bun:test";

import { applyThreadDeletionToAppState } from "./chat";
import { createEmptyAppStateSnapshot, normalizeAppStateSnapshot } from "./workspacePersistence";

describe("applyThreadDeletionToAppState", () => {
  it("deletes work owned by the removed Thread", () => {
    const snapshot = {
      ...createEmptyAppStateSnapshot(),
      threadWork: {
        "thread-1": { queuedMessages: [{ id: "queue-1", content: "Continue" }] },
        "thread-2": { queuedMessages: [] },
      },
    };

    expect(applyThreadDeletionToAppState(snapshot, ["thread-1"]).threadWork).toEqual({
      "thread-2": { queuedMessages: [] },
    });
  });

  it("deletes Thread Action history owned by the removed Thread", () => {
    const snapshot = {
      ...createEmptyAppStateSnapshot(),
      threadActions: [
        {
          id: "action-1",
          threadId: "thread-1",
          action: "compact" as const,
          runtimeId: "kimi" as const,
          completedAt: "2026-07-27T08:00:00.000Z",
        },
        {
          id: "action-2",
          threadId: "thread-2",
          action: "compact" as const,
          runtimeId: "kimi" as const,
          completedAt: "2026-07-27T08:01:00.000Z",
        },
      ],
    };

    expect(applyThreadDeletionToAppState(snapshot, ["thread-1"]).threadActions).toEqual([
      snapshot.threadActions[1],
    ]);
  });

  it("deletes a middle Workspace and keeps the remaining Workspace order valid", () => {
    const snapshot = {
      ...createEmptyAppStateSnapshot(),
      workspaces: [
        { id: "workspace-3", name: "Later", order: 2 },
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      activeWorkspaceId: "workspace-2",
    };

    const result = applyThreadDeletionToAppState(snapshot, [], {
      kind: "workspace",
      workspaceId: "workspace-2",
    });

    expect(result.workspaces).toEqual([
      { id: "workspace-1", name: "Personal", order: 0 },
      { id: "workspace-3", name: "Later", order: 1 },
    ]);
    expect(normalizeAppStateSnapshot(result)).not.toBe(null);
  });

  it("keeps Workspace order valid when deleting the first, last, or only Workspace", () => {
    const snapshot = {
      ...createEmptyAppStateSnapshot(),
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
        { id: "workspace-3", name: "Later", order: 2 },
      ],
      activeWorkspaceId: "workspace-1",
    };

    expect(
      applyThreadDeletionToAppState(snapshot, [], {
        kind: "workspace",
        workspaceId: "workspace-1",
      }).workspaces,
    ).toEqual([
      { id: "workspace-2", name: "Client", order: 0 },
      { id: "workspace-3", name: "Later", order: 1 },
    ]);
    expect(
      applyThreadDeletionToAppState(snapshot, [], {
        kind: "workspace",
        workspaceId: "workspace-3",
      }).workspaces,
    ).toEqual([
      { id: "workspace-1", name: "Personal", order: 0 },
      { id: "workspace-2", name: "Client", order: 1 },
    ]);
    expect(
      applyThreadDeletionToAppState(
        {
          ...createEmptyAppStateSnapshot(),
          workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
          activeWorkspaceId: "workspace-1",
        },
        [],
        { kind: "workspace", workspaceId: "workspace-1" },
      ).workspaces,
    ).toEqual([]);
  });
});
