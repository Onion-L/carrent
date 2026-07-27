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
});
