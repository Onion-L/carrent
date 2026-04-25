import { describe, expect, it } from "bun:test";
import type { DraftThreadRecord } from "./draftThreads";
import {
  createDraftThread,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
} from "./draftThreads";

function makeDraft(
  overrides: Partial<DraftThreadRecord> = {},
): DraftThreadRecord {
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

describe("draftThreads", () => {
  it("creates a draft with draftId and preallocated threadId", () => {
    const result = createDraftThread([], "project-1", " New thread ");

    expect(result.draft?.projectId).toBe("project-1");
    expect(result.draft?.title).toBe("New thread");
    expect(result.draft?.draftId).toMatch(/^draft-/);
    expect(result.draft?.preallocatedThreadId).toMatch(/^thread-/);
    expect(result.draft?.draftId).not.toBe(result.draft?.preallocatedThreadId);
    expect(result.draft?.createdAt).toBeString();
    expect(result.draft?.messages).toEqual([]);
    expect(result.drafts).toHaveLength(1);
  });

  it("returns no draft for a blank title and leaves drafts unchanged", () => {
    const drafts = [makeDraft()];

    const result = createDraftThread(drafts, "project-1", "   ");

    expect(result.draft).toBeNull();
    expect(result.drafts).toBe(drafts);
    expect(result.drafts).toHaveLength(1);
  });

  it("marks a draft as promoted without removing it yet", () => {
    const drafts = [makeDraft()];

    const nextDrafts = markPromotedDraftThreadByRef(
      drafts,
      "draft-1",
      "thread-real",
    );

    expect(nextDrafts).toHaveLength(1);
    expect(nextDrafts[0]?.promotedToThreadId).toBe("thread-real");
    expect(nextDrafts[0]?.draftId).toBe("draft-1");
  });

  it("finalizes a promoted draft by removing it from the draft list", () => {
    const drafts = [
      makeDraft({
        promotedToThreadId: "thread-real",
      }),
    ];

    const nextDrafts = finalizePromotedDraftThreadByRef(drafts, "draft-1");

    expect(nextDrafts).toHaveLength(0);
  });

  it("does not remove an unpromoted draft when finalizing", () => {
    const drafts = [makeDraft()];

    const nextDrafts = finalizePromotedDraftThreadByRef(drafts, "draft-1");

    expect(nextDrafts).toHaveLength(1);
    expect(nextDrafts[0]?.draftId).toBe("draft-1");
  });
});
