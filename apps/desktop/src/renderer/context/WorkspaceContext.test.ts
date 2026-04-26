import { describe, expect, it } from "bun:test";

import type { Message } from "../mock/uiShellData";
import { applyMessagePartUpdate, mergeMessagesIntoWorkspace } from "./WorkspaceContext";

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

describe("applyMessagePartUpdate", () => {
  it("appends text to message content and trailing text part", () => {
    const message = makeMessage({
      role: "assistant",
      content: "Hel",
      parts: [{ type: "text", content: "Hel" }],
    });

    expect(
      applyMessagePartUpdate(message, {
        kind: "append-text",
        content: "lo",
      }),
    ).toMatchObject({
      content: "Hello",
      parts: [{ type: "text", content: "Hello" }],
    });
  });

  it("upserts shell parts without mutating message content", () => {
    const message = makeMessage({
      role: "assistant",
      content: "Done",
      parts: [{ type: "text", content: "Done" }],
    });

    const withShell = applyMessagePartUpdate(message, {
      kind: "upsert-shell",
      shell: {
        type: "shell",
        id: "shell-1",
        command: "pwd",
        output: "",
        status: "running",
      },
    });

    expect(
      applyMessagePartUpdate(withShell, {
        kind: "upsert-shell",
        shell: {
          type: "shell",
          id: "shell-1",
          command: "pwd",
          output: "/tmp",
          status: "completed",
        },
      }),
    ).toMatchObject({
      content: "Done",
      parts: [
        { type: "text", content: "Done" },
        {
          type: "shell",
          id: "shell-1",
          command: "pwd",
          output: "/tmp",
          status: "completed",
        },
      ],
    });
  });
});
