import { describe, expect, it } from "bun:test";

import { getVerificationDraftById } from "../context/DraftThreadContext";

describe("getVerificationDraftById", () => {
  it("returns null for unrelated draft ids", () => {
    expect(getVerificationDraftById("draft-2")).toBe(null);
  });

  it("returns the verification draft only for /draft/foo", () => {
    const result = getVerificationDraftById("foo");

    expect(result?.draftId).toBe("foo");
    expect(result?.projectId).toBe("carrent");
    expect(result?.messages).toHaveLength(1);
  });
});
