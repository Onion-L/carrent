import { describe, expect, it } from "bun:test";

import type { Message } from "../mock/uiShellData";
import type { DraftThreadRecord } from "../lib/draftThreads";
import { resolveDraftRouteData } from "./DraftThreadPage";

type TextMessage = {
  id: string;
  role: "user";
  agentId: string;
  timestamp: string;
  threadId: string;
  content: string;
  type?: "text";
  duration?: string;
};

function makeMessage(overrides: Partial<TextMessage> = {}): TextMessage {
  return {
    id: "message-1",
    role: "user",
    agentId: "architect",
    timestamp: "09:00",
    threadId: "draft-thread-1",
    content: "hello",
    ...overrides,
  };
}

function makeDraft(
  overrides: Partial<DraftThreadRecord> = {},
): DraftThreadRecord {
  return {
    draftId: "draft-1",
    projectId: "project-1",
    title: "Draft 1",
    preallocatedThreadId: "thread-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    messages: [makeMessage()],
    ...overrides,
  };
}

describe("resolveDraftRouteData", () => {
  it("returns the matching draft", () => {
    const drafts = [makeDraft(), makeDraft({ draftId: "draft-2", title: "Draft 2" })];

    const result = resolveDraftRouteData(drafts, "draft-2");

    expect(result?.draftId).toBe("draft-2");
    expect(result?.title).toBe("Draft 2");
  });

  it("returns null when the draft id is missing", () => {
    expect(resolveDraftRouteData([makeDraft()], "draft-missing")).toBe(null);
  });

  it("provides a seeded verification draft for /draft/foo", () => {
    const result = resolveDraftRouteData([], "foo");

    expect(result?.draftId).toBe("foo");
    expect(result?.title).toBe("Draft thread");
    expect(result?.messages).toHaveLength(1);
  });
});
