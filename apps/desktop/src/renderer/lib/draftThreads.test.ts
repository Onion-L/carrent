import { describe, expect, it } from "bun:test";
import type { DraftThreadRecord } from "./draftThreads";
import {
  buildDraftThreadRecord,
  createDraftThread,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
} from "./draftThreads";

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

describe("draftThreads", () => {
  it("builds a trimmed draft record", () => {
    const draft = buildDraftThreadRecord("project-1", " New thread ");

    expect(draft === null).toBe(false);
    if (!draft) {
      throw new Error("Expected draft to be created");
    }

    expect(draft.projectId).toBe("project-1");
    expect(draft.title).toBe("New thread");
    expect(draft.draftId.startsWith("draft-")).toBe(true);
    expect(draft.preallocatedThreadId.startsWith("thread-")).toBe(true);
    expect(draft.draftId).not.toBe(draft.preallocatedThreadId);
    expect(draft.createdAt).toBeString();
    expect(draft.messages).toEqual([]);
  });

  it("returns no draft record for a blank title", () => {
    expect(buildDraftThreadRecord("project-1", "   ")).toBe(null);
  });

  it("builds a draft record with the default title used by one-click creation", () => {
    const draft = buildDraftThreadRecord("project-1", "New thread");

    expect(draft?.title).toBe("New thread");
  });

  it("creates a draft with draftId and preallocated threadId", () => {
    const result = createDraftThread([], "project-1", " New thread ");
    const draft = result.draft;

    expect(draft === null).toBe(false);
    if (!draft) {
      throw new Error("Expected draft to be created");
    }

    expect(draft.projectId).toBe("project-1");
    expect(draft.title).toBe("New thread");
    expect(draft.draftId.startsWith("draft-")).toBe(true);
    expect(draft.preallocatedThreadId.startsWith("thread-")).toBe(true);
    expect(draft.draftId).not.toBe(draft.preallocatedThreadId);
    expect(draft.createdAt).toBeString();
    expect(draft.messages).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toEqual(draft);
  });

  it("returns no draft for a blank title and leaves drafts unchanged", () => {
    const drafts = [makeDraft()];

    const result = createDraftThread(drafts, "project-1", "   ");

    expect(result.draft).toBe(null);
    expect(result.drafts).toBe(drafts);
    expect(result.drafts).toHaveLength(1);
  });

  it("marks a draft as promoted without removing it yet", () => {
    const drafts = [makeDraft()];

    const nextDrafts = markPromotedDraftThreadByRef(drafts, "draft-1", "thread-real");

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
