import { describe, expect, it } from "bun:test";

import type { Message } from "../mock/uiShellData";
import { mergeMessagesIntoWorkspace } from "./WorkspaceContext";

type TextMessage = Extract<Message, { role: "user" | "assistant"; content: string }>;

function makeMessage(overrides: Partial<TextMessage> = {}): TextMessage {
  return {
    id: "message-1",
    role: "user",
    agentId: "architect",
    timestamp: "09:00",
    threadId: "thread-1",
    content: "hello",
    type: "text",
    ...overrides,
  };
}

describe("mergeMessagesIntoWorkspace", () => {
  it("adds promoted draft messages only when they are not already present", () => {
    const existing = [makeMessage({ id: "message-1" })];
    const incoming = [
      makeMessage({ id: "message-1", content: "updated" }),
      makeMessage({ id: "message-2", role: "assistant", content: "" }),
    ];

    expect(mergeMessagesIntoWorkspace(existing, incoming)).toEqual([
      makeMessage({ id: "message-1", content: "updated" }),
      makeMessage({ id: "message-2", role: "assistant", content: "" }),
    ]);
  });

  it("preserves unrelated workspace messages", () => {
    const existing = [
      makeMessage({ id: "message-1", threadId: "thread-1" }),
      makeMessage({ id: "message-2", threadId: "thread-2" }),
    ];
    const incoming = [makeMessage({ id: "message-3", threadId: "thread-1" })];

    expect(mergeMessagesIntoWorkspace(existing, incoming)).toEqual([
      makeMessage({ id: "message-1", threadId: "thread-1" }),
      makeMessage({ id: "message-2", threadId: "thread-2" }),
      makeMessage({ id: "message-3", threadId: "thread-1" }),
    ]);
  });
});
