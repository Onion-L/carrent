import { describe, expect, it } from "bun:test";

import type { Message } from "../../shared/threadContent";
import { normalizeAppStateSnapshot, type AppThreadRecord } from "../../shared/workspacePersistence";
import {
  applyRunChecklistUpdate,
  applyMessagePartUpdate,
  buildChangedFilesMessage,
  deleteThreadMessagesAfterCleanup,
  mergeThreadMessages,
  prepareThreadDataDeletion,
  removeMessagesForThreads,
  updateMessageAndPruneThreadAfter,
} from "./ThreadContentContext";

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

describe("applyRunChecklistUpdate", () => {
  const thread: AppThreadRecord = {
    id: "thread-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    title: "Checklist",
    createdAt: "2026-07-27T08:00:00.000Z",
    lastActivityAt: "2026-07-27T08:00:00.000Z",
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
  };

  it("auto-expands the first snapshot and fully replaces later entries", () => {
    const first = applyRunChecklistUpdate(thread, {
      kind: "snapshot",
      runId: "run-1",
      runtimeId: "kimi",
      entries: [{ content: "Inspect", status: "in_progress" }],
    });
    const collapsed = applyRunChecklistUpdate(first, { kind: "expanded", expanded: false });
    const replaced = applyRunChecklistUpdate(collapsed, {
      kind: "snapshot",
      runId: "run-1",
      runtimeId: "kimi",
      entries: [
        { content: "Implement", status: "completed" },
        { content: "Verify", status: "in_progress" },
      ],
    });

    expect(first.runChecklist?.expanded).toBe(true);
    expect(replaced.runChecklist).toMatchObject({
      runId: "run-1",
      outcome: "running",
      expanded: false,
      entries: [
        { content: "Implement", status: "completed" },
        { content: "Verify", status: "in_progress" },
      ],
    });
  });

  it("retains reported item states at terminal outcomes and clears on the next Run", () => {
    const active = applyRunChecklistUpdate(thread, {
      kind: "snapshot",
      runId: "run-1",
      runtimeId: "kimi",
      entries: [
        { content: "Implement", status: "in_progress" },
        { content: "Verify", status: "pending" },
      ],
    });
    const failed = applyRunChecklistUpdate(active, {
      kind: "outcome",
      runId: "run-1",
      outcome: "failed",
    });
    const cleared = applyRunChecklistUpdate(failed, { kind: "started", runId: "run-2" });

    expect(failed.runChecklist).toMatchObject({
      outcome: "failed",
      entries: [
        { content: "Implement", status: "in_progress" },
        { content: "Verify", status: "pending" },
      ],
    });
    expect(cleared.runChecklist).toBeUndefined();
  });

  it("records completed, failed, and cancelled outcomes without changing entries", () => {
    const active = applyRunChecklistUpdate(thread, {
      kind: "snapshot",
      runId: "run-1",
      runtimeId: "kimi",
      entries: [{ content: "Implement", status: "in_progress" }],
    });

    for (const outcome of ["completed", "failed", "cancelled"] as const) {
      const settled = applyRunChecklistUpdate(active, {
        kind: "outcome",
        runId: "run-1",
        outcome,
      });
      expect(settled.runChecklist).toMatchObject({
        outcome,
        entries: [{ content: "Implement", status: "in_progress" }],
      });
    }
  });

  it("uses a structured empty snapshot to clear the current Checklist", () => {
    const active = applyRunChecklistUpdate(thread, {
      kind: "snapshot",
      runId: "run-1",
      runtimeId: "kimi",
      entries: [{ content: "Implement", status: "in_progress" }],
    });

    expect(
      applyRunChecklistUpdate(active, {
        kind: "snapshot",
        runId: "run-1",
        runtimeId: "kimi",
        entries: [],
      }).runChecklist,
    ).toBeUndefined();
  });
});

describe("buildChangedFilesMessage", () => {
  it("creates a changed_files message preserving snapshot fields and flags", () => {
    const now = 1_700_000_000_000;
    const message = buildChangedFilesMessage({
      threadId: "thread-1",
      result: {
        state: "ready",
        baseRevision: "abc123",
        capturedAt: "2024-01-01T00:00:00.000Z",
        projectRelativeRoot: ".",
        files: [
          { path: "a.txt", additions: 1, deletions: 2, binary: false, untracked: false },
          { path: "b.bin", additions: 0, deletions: 0, binary: true, untracked: false },
          { path: "c.txt", additions: 3, deletions: 0, binary: false, untracked: true },
          {
            path: "d.txt",
            additions: 0,
            deletions: 0,
            binary: false,
            untracked: true,
            omitted: true,
          },
        ],
        patch: "diff --git a/a.txt b/a.txt\n...",
        truncated: true,
      },
      now,
      formatTime: () => "12:00",
    });

    expect(message.role).toBe("assistant");
    expect(message.type).toBe("changed_files");
    expect(message.threadId).toBe("thread-1");
    expect(message.content).toBe("Workspace changes");
    expect(message.createdAt).toBe("2023-11-14T22:13:20.000Z");
    expect(message.changedFiles).toEqual([
      { path: "a.txt", additions: 1, deletions: 2, binary: false, untracked: false },
      { path: "b.bin", additions: 0, deletions: 0, binary: true, untracked: false },
      { path: "c.txt", additions: 3, deletions: 0, binary: false, untracked: true },
      { path: "d.txt", additions: 0, deletions: 0, binary: false, untracked: true, omitted: true },
    ]);
    expect(message.snapshot).toEqual({
      baseRevision: "abc123",
      capturedAt: "2024-01-01T00:00:00.000Z",
      patch: "diff --git a/a.txt b/a.txt\n...",
      truncated: true,
    });
    expect(
      normalizeAppStateSnapshot({
        version: 1,
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
        associations: [
          {
            workspaceId: "workspace-1",
            projectId: "project-1",
            order: 0,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "approval-required",
          },
        ],
        threads: [
          {
            id: "thread-1",
            workspaceId: "workspace-1",
            projectId: "project-1",
            title: "First",
            createdAt: "2023-11-14T22:00:00.000Z",
            lastActivityAt: "2023-11-14T22:13:20.000Z",
            runtimeId: "kimi",
            runtimeMode: "approval-required",
            planMode: false,
          },
        ],
        threadMessages: [{ ...message, attachments: [] }],
        activeWorkspaceId: "workspace-1",
      }),
    ).not.toBe(null);
  });
});

describe("mergeThreadMessages", () => {
  it("merges incoming messages without duplicating existing ones", () => {
    const existing = [makeMessage({ id: "message-1" })];
    const incoming = [
      makeMessage({ id: "message-1", content: "updated" }),
      makeMessage({ id: "message-2", role: "assistant", content: "" }),
    ];

    expect(mergeThreadMessages(existing, incoming)).toEqual([
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

    expect(mergeThreadMessages(existing, incoming)).toEqual([
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
            kind: "image" as const,
            name: "screenshot.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
          },
        ],
      }),
    ];

    const merged = mergeThreadMessages(existing, incoming);
    expect(merged).toHaveLength(2);
    expect((merged[1] as TextMessage).attachments).toEqual(incoming[0].attachments);
  });
});

describe("thread data deletion", () => {
  const attachment = (storageKey: string) => ({
    id: storageKey,
    kind: "image" as const,
    name: storageKey,
    mimeType: "image/png",
    size: 1,
    storageKey,
  });

  const fileAttachment = (storageKey: string) => ({
    id: storageKey,
    kind: "file" as const,
    name: storageKey,
    mimeType: "text/plain",
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

  it("collects File Attachment storage keys exactly like image keys", () => {
    const messages = [
      makeMessage({
        id: "delete",
        threadId: "thread-1",
        attachments: [attachment("one.png"), fileAttachment("two.ts")],
      }),
      makeMessage({ id: "keep", threadId: "thread-2" }),
    ];

    expect(prepareThreadDataDeletion(messages, ["thread-1"]).request).toEqual({
      threadIds: ["thread-1"],
      attachmentStorageKeys: ["one.png", "two.ts"],
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

  it("preserves an attachment shared with a surviving thread", () => {
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

    expect(prepareThreadDataDeletion(messages, ["thread-1"]).request).toEqual({
      threadIds: ["thread-1"],
      attachmentStorageKeys: [],
    });
  });

  it("collects draft and queue attachment keys owned by a deleted thread", () => {
    const messages = [makeMessage({ id: "keep", threadId: "thread-2" })];
    const threadWork = {
      "thread-1": {
        draft: {
          content: "draft",
          attachedSkillNames: [],
          attachments: [attachment("draft.png")],
        },
        queuedMessages: [
          { id: "q1", content: "queued", attachments: [fileAttachment("queued.ts")] },
        ],
      },
    };

    expect(prepareThreadDataDeletion(messages, ["thread-1"], threadWork).request).toEqual({
      threadIds: ["thread-1"],
      attachmentStorageKeys: ["draft.png", "queued.ts"],
    });
  });

  it("keeps storage keys referenced only by a surviving thread's draft or queue", () => {
    const messages = [
      makeMessage({
        id: "delete",
        threadId: "thread-1",
        attachments: [attachment("gone.png")],
      }),
    ];
    const threadWork = {
      "thread-2": {
        draft: {
          content: "surviving",
          attachedSkillNames: [],
          attachments: [attachment("kept.png")],
        },
        queuedMessages: [],
      },
    };

    expect(prepareThreadDataDeletion(messages, ["thread-1"], threadWork).request).toEqual({
      threadIds: ["thread-1"],
      attachmentStorageKeys: ["gone.png"],
    });
  });

  it("preserves a deleted thread draft attachment shared with a survivor", () => {
    const messages = [
      makeMessage({
        id: "keep",
        threadId: "thread-2",
        attachments: [attachment("shared.png")],
      }),
    ];
    const threadWork = {
      "thread-1": {
        draft: {
          content: "deleted draft",
          attachedSkillNames: [],
          attachments: [attachment("shared.png")],
        },
        queuedMessages: [],
      },
    };

    expect(prepareThreadDataDeletion(messages, ["thread-1"], threadWork).request).toEqual({
      threadIds: ["thread-1"],
      attachmentStorageKeys: [],
    });
  });

  it("treats a deleted thread's message and its own queue as one owner", () => {
    const messages = [
      makeMessage({
        id: "delete",
        threadId: "thread-1",
        attachments: [attachment("same.png")],
      }),
    ];
    const threadWork = {
      "thread-1": {
        queuedMessages: [{ id: "q1", content: "queued", attachments: [attachment("same.png")] }],
      },
    };

    expect(prepareThreadDataDeletion(messages, ["thread-1"], threadWork).request).toEqual({
      threadIds: ["thread-1"],
      attachmentStorageKeys: ["same.png"],
    });
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

  it("upserts, resolves, and interrupts Plan Reviews", () => {
    const message = makeMessage({ role: "assistant", content: "", parts: [] });
    const review = {
      type: "plan_review" as const,
      id: "review-1",
      permissionId: "permission-1",
      content: "# Plan",
      status: "pending" as const,
      options: [{ optionId: "plan_approve", name: "Approve", kind: "allow_once" as const }],
    };

    const pending = applyMessagePartUpdate(message, { kind: "upsert-plan-review", review });
    const resolved = applyMessagePartUpdate(pending, {
      kind: "resolve-plan-review",
      permissionId: "permission-1",
      status: "approved",
      selectedOptionId: "plan_approve",
      selectedOptionName: "Approve",
    });
    expect(resolved).toMatchObject({
      parts: [
        {
          type: "plan_review",
          status: "approved",
          selectedOptionId: "plan_approve",
          selectedOptionName: "Approve",
        },
      ],
    });

    const interrupted = applyMessagePartUpdate(pending, { kind: "interrupt-plan-reviews" });
    expect(interrupted).toMatchObject({
      parts: [{ type: "plan_review", status: "interrupted" }],
    });
  });

  it("upserts, resolves, and interrupts structured questions", () => {
    const message = makeMessage({ role: "assistant", content: "", parts: [] });
    const question = {
      type: "question" as const,
      id: "question-q-1",
      questionId: "q-1",
      status: "pending" as const,
      questions: [{ header: "Language", question: "Which language should the module use?" }],
    };

    const pending = applyMessagePartUpdate(message, { kind: "upsert-question", question });
    expect(pending).toMatchObject({
      parts: [{ type: "question", questionId: "q-1", status: "pending" }],
    });

    // A repeated upsert for the same request replaces instead of duplicating.
    const reUpserted = applyMessagePartUpdate(pending, { kind: "upsert-question", question });
    expect(reUpserted.type !== "changed_files" && reUpserted.parts).toHaveLength(1);

    const resolved = applyMessagePartUpdate(pending, {
      kind: "resolve-question",
      questionId: "q-1",
      status: "answered",
      answers: [{ questionIndex: 0, labels: ["TypeScript"] }],
    });
    expect(resolved).toMatchObject({
      parts: [
        {
          type: "question",
          status: "answered",
          answers: [{ questionIndex: 0, labels: ["TypeScript"] }],
        },
      ],
    });

    const skipped = applyMessagePartUpdate(pending, {
      kind: "resolve-question",
      questionId: "q-1",
      status: "skipped",
    });
    expect(skipped).toMatchObject({
      parts: [{ type: "question", status: "skipped" }],
    });
    expect(
      skipped.type !== "changed_files" &&
        skipped.parts?.[0]?.type === "question" &&
        skipped.parts[0].answers,
    ).toBeUndefined();

    const interrupted = applyMessagePartUpdate(pending, { kind: "interrupt-questions" });
    expect(interrupted).toMatchObject({
      parts: [{ type: "question", status: "interrupted" }],
    });
    // Settled records are never re-interrupted.
    const settled = applyMessagePartUpdate(resolved, { kind: "interrupt-questions" });
    expect(settled).toMatchObject({
      parts: [{ type: "question", status: "answered" }],
    });
  });

  it("upserts Subagent Tasks by id while preserving insertion order", () => {
    const message = makeMessage({ role: "assistant", content: "", parts: [] });
    const task = {
      type: "subagent_task" as const,
      id: "0:tool_agent",
      runtimeId: "kimi" as const,
      source: "agent" as const,
      agentType: "coder",
      description: "Implement persistence",
      prompt: "Implement step 1",
      background: false,
      status: "running" as const,
      startedAt: 1000,
    };

    const withTask = applyMessagePartUpdate(message, { kind: "upsert-subagent-task", task });
    const withReasoning = applyMessagePartUpdate(withTask, {
      kind: "upsert-reasoning",
      reasoning: {
        type: "reasoning",
        id: "reasoning-1",
        content: "Working",
        status: "running",
      },
    });
    const updated = applyMessagePartUpdate(withReasoning, {
      kind: "upsert-subagent-task",
      task: {
        ...task,
        status: "completed",
        runtimeAgentId: "agent-0",
        summary: "Done.",
        finishedAt: 2000,
      },
    });

    expect(updated).toMatchObject({
      content: "",
      parts: [
        {
          type: "subagent_task",
          id: "0:tool_agent",
          status: "completed",
          runtimeAgentId: "agent-0",
          summary: "Done.",
          startedAt: 1000,
          finishedAt: 2000,
        },
        { type: "reasoning", id: "reasoning-1" },
      ],
    });
  });

  it("interrupts only running Subagent Tasks and keeps settled and detached tasks", () => {
    const baseTask = {
      type: "subagent_task" as const,
      runtimeId: "kimi" as const,
      source: "agent" as const,
      description: "Task",
      background: false,
      startedAt: 1000,
    };
    const message = makeMessage({
      role: "assistant",
      content: "",
      parts: [
        { ...baseTask, id: "task-running", status: "running" as const },
        {
          ...baseTask,
          id: "task-completed",
          status: "completed" as const,
          finishedAt: 2000,
        },
        { ...baseTask, id: "task-detached", status: "detached" as const, finishedAt: 2000 },
        { ...baseTask, id: "task-failed", status: "failed" as const, finishedAt: 2000 },
      ],
    });

    const interrupted = applyMessagePartUpdate(message, { kind: "interrupt-subagent-tasks" });

    expect(interrupted).toMatchObject({
      parts: [
        { id: "task-running", status: "interrupted" },
        { id: "task-completed", status: "completed" },
        { id: "task-detached", status: "detached" },
        { id: "task-failed", status: "failed" },
      ],
    });
  });

  it("upserts error parts by id without mutating message content", () => {
    const message = makeMessage({
      role: "assistant",
      content: "Done",
      parts: [{ type: "text", content: "Done" }],
    });

    const withError = applyMessagePartUpdate(message, {
      kind: "upsert-error",
      error: { type: "error", id: "error-1", message: "First failure" },
    });

    expect(
      applyMessagePartUpdate(withError, {
        kind: "upsert-error",
        error: { type: "error", id: "error-1", message: "Updated failure" },
      }),
    ).toMatchObject({
      content: "Done",
      parts: [
        { type: "text", content: "Done" },
        { type: "error", id: "error-1", message: "Updated failure" },
      ],
    });
  });
});
