import { describe, expect, it } from "bun:test";

import type { Message, ProjectRecord } from "../mock/uiShellData";
import {
  applyMessagePartUpdate,
  collectProjectThreadIds,
  deleteThreadMessagesAfterCleanup,
  mergeMessagesIntoWorkspace,
  prepareThreadDataDeletion,
  removeMessagesForThreads,
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

describe("thread data deletion", () => {
  const attachment = (storageKey: string) => ({
    id: storageKey,
    name: storageKey,
    mimeType: "image/png",
    size: 1,
    storageKey,
  });

  it("collects a deleted thread's attachments and preserves unrelated messages", () => {
    const messages = [
      makeMessage({
        id: "delete",
        threadId: "thread-1",
        attachments: [attachment("one.png")],
      }),
      makeMessage({ id: "keep", threadId: "thread-2" }),
    ];

    expect(prepareThreadDataDeletion(messages, ["thread-1"])).toEqual({
      request: { threadIds: ["thread-1"], attachmentStorageKeys: ["one.png"] },
      remainingMessages: [makeMessage({ id: "keep", threadId: "thread-2" })],
    });
  });

  it("preserves unrelated messages added while cleanup is pending", () => {
    const latestMessages = [
      makeMessage({ id: "delete", threadId: "thread-1" }),
      makeMessage({ id: "existing", threadId: "thread-2" }),
      makeMessage({ id: "late", threadId: "thread-3" }),
    ];

    expect(removeMessagesForThreads(latestMessages, ["thread-1"])).toEqual([
      makeMessage({ id: "existing", threadId: "thread-2" }),
      makeMessage({ id: "late", threadId: "thread-3" }),
    ]);
  });

  it("deduplicates attachment references within a chat", () => {
    const messages = [
      makeMessage({
        id: "chat-1",
        threadId: "chat-1",
        attachments: [attachment("shared-in-chat.png")],
      }),
      makeMessage({
        id: "chat-2",
        threadId: "chat-1",
        attachments: [attachment("shared-in-chat.png")],
      }),
    ];

    expect(prepareThreadDataDeletion(messages, ["chat-1"]).request).toEqual({
      threadIds: ["chat-1"],
      attachmentStorageKeys: ["shared-in-chat.png"],
    });
  });

  it("collects every thread and message owned by a project", () => {
    const projects: ProjectRecord[] = [
      {
        id: "project-1",
        name: "One",
        path: "/tmp/one",
        threads: [
          { id: "thread-1", title: "One", updatedAt: "now" },
          { id: "thread-2", title: "Two", updatedAt: "now" },
        ],
      },
      {
        id: "project-2",
        name: "Two",
        path: "/tmp/two",
        threads: [{ id: "thread-3", title: "Three", updatedAt: "now" }],
      },
    ];
    const messages = [
      makeMessage({ id: "one", threadId: "thread-1" }),
      makeMessage({ id: "two", threadId: "thread-2" }),
      makeMessage({ id: "three", threadId: "thread-3" }),
    ];
    const threadIds = collectProjectThreadIds(projects, "project-1");

    expect(threadIds).toEqual(["thread-1", "thread-2"]);
    expect(prepareThreadDataDeletion(messages, threadIds).remainingMessages).toEqual([
      makeMessage({ id: "three", threadId: "thread-3" }),
    ]);
  });

  it("leaves messages unchanged when persistent cleanup fails", async () => {
    const messages = [makeMessage({ id: "delete", threadId: "thread-1" })];

    let error: unknown;
    try {
      await deleteThreadMessagesAfterCleanup(messages, ["thread-1"], async () => {
        throw new Error("disk full");
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof Error ? error.message : String(error)).toBe("disk full");
    expect(messages).toEqual([makeMessage({ id: "delete", threadId: "thread-1" })]);
  });

  it("rejects deletion when an attachment is shared across threads", () => {
    const messages = [
      makeMessage({
        id: "one",
        threadId: "thread-1",
        attachments: [attachment("shared.png")],
      }),
      makeMessage({
        id: "two",
        threadId: "thread-2",
        attachments: [attachment("shared.png")],
      }),
    ];

    let error: unknown;
    try {
      prepareThreadDataDeletion(messages, ["thread-1"]);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof Error ? error.message : String(error)).toContain(
      "shared by multiple threads",
    );
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

  it("preserves reasoning and shell activity order", () => {
    const message = makeMessage({
      role: "assistant",
      content: "",
      parts: [],
    });

    const withFirstReasoning = applyMessagePartUpdate(message, {
      kind: "upsert-reasoning",
      reasoning: {
        type: "reasoning",
        id: "kimi-thinking-1",
        content: "Inspect first",
        status: "completed",
      },
    });
    const withShell = applyMessagePartUpdate(withFirstReasoning, {
      kind: "upsert-shell",
      shell: {
        type: "shell",
        id: "tool-shell-1",
        command: "pwd",
        output: "",
        status: "running",
      },
    });
    const withCompletedShell = applyMessagePartUpdate(withShell, {
      kind: "upsert-shell",
      shell: {
        type: "shell",
        id: "tool-shell-1",
        command: "pwd",
        output: "/tmp",
        status: "completed",
      },
    });

    expect(
      applyMessagePartUpdate(withCompletedShell, {
        kind: "upsert-reasoning",
        reasoning: {
          type: "reasoning",
          id: "kimi-thinking-2",
          content: "Verify result",
          status: "running",
        },
      }),
    ).toMatchObject({
      parts: [{ id: "kimi-thinking-1" }, { id: "tool-shell-1" }, { id: "kimi-thinking-2" }],
    });
  });
});
