import { describe, expect, it } from "bun:test";

import type { DraftThreadRecord } from "../lib/draftThreads";
import { buildPromotedThreadRecord } from "./useDraftThreadPromotion";

function makeDraft(overrides: Partial<DraftThreadRecord> = {}): DraftThreadRecord {
  return {
    draftId: "draft-1",
    projectId: "project-1",
    title: "Draft",
    preallocatedThreadId: "thread-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    messages: [],
    ...overrides,
  };
}

describe("buildPromotedThreadRecord", () => {
  it("preserves the draft runtime model id when the promoted thread does not have one", () => {
    const promoted = buildPromotedThreadRecord(
      {
        id: "thread-1",
        title: "Thread",
        updatedAt: "now",
      },
      makeDraft({ runtimeModelId: "gpt-5" }),
    );

    expect(promoted.runtimeModelId).toBe("gpt-5");
  });

  it("keeps the promoted thread runtime model id when it is already present", () => {
    const promoted = buildPromotedThreadRecord(
      {
        id: "thread-1",
        title: "Thread",
        updatedAt: "now",
        runtimeModelId: "claude-sonnet",
      },
      makeDraft({ runtimeModelId: "gpt-5" }),
    );

    expect(promoted.runtimeModelId).toBe("claude-sonnet");
  });
});
