import { describe, expect, it } from "bun:test";

import { applyThreadDeletionToAppState } from "./chat";
import { createEmptyAppStateSnapshot } from "./workspacePersistence";

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
});
