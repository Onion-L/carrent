import { describe, expect, it } from "bun:test";

import { getVerificationDraftById } from "../context/DraftThreadContext";
import type { DraftThreadRecord } from "../lib/draftThreads";
import { resolvePromotedDraftRoute } from "./DraftThreadPage";

function makeDraft(overrides: Partial<DraftThreadRecord> = {}): DraftThreadRecord {
  return {
    draftId: "draft-1",
    projectId: "project-1",
    title: "Draft 1",
    preallocatedThreadId: "thread-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    messages: [],
    ...overrides,
  };
}

describe("resolvePromotedDraftRoute", () => {
  it("returns the promoted thread route when the draft has been promoted", () => {
    expect(
      resolvePromotedDraftRoute(
        makeDraft({
          draftId: "draft-1",
          projectId: "project-1",
          promotedToThreadId: "thread-99",
        }),
      ),
    ).toBe("/thread/project-1/thread-99");
  });

  it("returns null when the draft has not been promoted", () => {
    expect(resolvePromotedDraftRoute(makeDraft())).toBe(null);
  });
});

describe("getVerificationDraftById", () => {
  it("returns null for unrelated draft ids", () => {
    expect(getVerificationDraftById("draft-2")).toBe(null);
  });

  it("returns the verification draft only for /draft/foo", () => {
    const result = getVerificationDraftById("foo");

    expect(result?.draftId).toBe("foo");
    expect(result?.projectId).toBe("project-1");
    expect(result?.messages).toHaveLength(1);
  });
});
