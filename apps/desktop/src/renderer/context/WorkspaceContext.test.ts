import { describe, expect, it } from "bun:test";

import type { Message } from "../mock/uiShellData";
import {
  applyMessagePartUpdate,
  mergeMessagesIntoWorkspace,
  updateMessageAndPruneThreadAfter,
} from "./WorkspaceContext";

type TextMessage = Extract<Message, { role: "user" | "assistant"; content: string }>;

function makeMessage(overrides: Partial<TextMessage> = {}): TextMessage {
  return {
    id: "message-1",
    role: "user",
    timestamp: "09:00",
    threadId: "thread-1",
    content: "hello",
    type: "text",
    ...overrides,
  };
}

describe("mergeMessagesIntoWorkspace", () => {
  it("merges incoming messages without duplicating existing ones", () => {
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

  it("preserves image attachment metadata when merging messages", () => {
    const existing = [makeMessage({ id: "message-1", threadId: "thread-1" })];
    const incoming = [
      makeMessage({
        id: "message-2",
        threadId: "thread-1",
        attachments: [
          {
            id: "a1",
            name: "screenshot.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
          },
        ],
      }),
    ];

    const merged = mergeMessagesIntoWorkspace(existing, incoming);
    expect(merged).toHaveLength(2);
    expect((merged[1] as TextMessage).attachments).toEqual(incoming[0].attachments);
  });
});

describe("updateMessageAndPruneThreadAfter", () => {
  it("updates the target message and removes later messages in the same thread", () => {
    const messages: Message[] = [
      makeMessage({ id: "user-1", threadId: "thread-1", content: "old" }),
      makeMessage({
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "old answer",
      }),
      makeMessage({
        id: "other-thread",
        threadId: "thread-2",
        content: "keep",
      }),
    ];

    expect(updateMessageAndPruneThreadAfter(messages, "user-1", "edited")).toEqual([
      makeMessage({ id: "user-1", threadId: "thread-1", content: "edited" }),
      makeMessage({
        id: "other-thread",
        threadId: "thread-2",
        content: "keep",
      }),
    ]);
  });

  it("keeps earlier messages from the edited thread", () => {
    const messages: Message[] = [
      makeMessage({ id: "user-1", threadId: "thread-1", content: "first" }),
      makeMessage({
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "first answer",
      }),
      makeMessage({ id: "user-2", threadId: "thread-1", content: "old" }),
      makeMessage({
        id: "assistant-2",
        threadId: "thread-1",
        role: "assistant",
        content: "stale answer",
      }),
    ];

    expect(updateMessageAndPruneThreadAfter(messages, "user-2", "edited")).toEqual([
      makeMessage({ id: "user-1", threadId: "thread-1", content: "first" }),
      makeMessage({
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "first answer",
      }),
      makeMessage({ id: "user-2", threadId: "thread-1", content: "edited" }),
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

  it("upserts reasoning parts without mutating message content", () => {
    const message = makeMessage({
      role: "assistant",
      content: "",
      parts: [],
    });

    const withReasoning = applyMessagePartUpdate(message, {
      kind: "upsert-reasoning",
      reasoning: {
        type: "reasoning",
        id: "reasoning-1",
        content: "Need to inspect",
        status: "running",
      },
    });

    expect(
      applyMessagePartUpdate(withReasoning, {
        kind: "upsert-reasoning",
        reasoning: {
          type: "reasoning",
          id: "reasoning-1",
          content: "Need to inspect files",
          status: "completed",
        },
      }),
    ).toMatchObject({
      content: "",
      parts: [
        {
          type: "reasoning",
          id: "reasoning-1",
          content: "Need to inspect files",
          status: "completed",
        },
      ],
    });
  });
});
