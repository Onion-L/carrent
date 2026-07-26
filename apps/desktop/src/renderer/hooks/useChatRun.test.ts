import { describe, expect, it } from "bun:test";

import type { ChatRunEvent } from "../../shared/chat";
import type { ChatPermissionRequest } from "../../shared/chatPermissions";
import type { ChatQuestionRequest } from "../../shared/chatQuestions";
import { createChatRunCoordinator } from "./useChatRun";

describe("createChatRunCoordinator", () => {
  it("delivers events that arrive before chat.send resolves", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {
      onDelta: (text) => received.push(`delta:${text}`),
      onComplete: (text) => received.push(`done:${text}`),
    });

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-1",
      runId: "run-1",
      text: "hello",
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "completed",
      requestKey: "request-1",
      runId: "run-1",
      text: "hello",
      finishedAt: "2026-04-25T00:00:00.000Z",
    } satisfies ChatRunEvent);

    expect(received).toEqual(["delta:hello", "done:hello"]);
    expect(coordinator.getSnapshot().isSending).toBe(false);
  });

  it("ignores events from a different request", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {
      onDelta: (text) => received.push(text),
    });

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-2",
      runId: "run-2",
      text: "wrong",
    } satisfies ChatRunEvent);

    expect(received).toEqual([]);
    expect(coordinator.getSnapshot().isSending).toBe(true);
  });

  it("keeps independent requests for different threads", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    expect(
      coordinator.beginRequest("request-1", "thread-1", {
        onDelta: (text) => received.push(`first:${text}`),
      }),
    ).toBe(true);
    expect(
      coordinator.beginRequest("request-2", "thread-2", {
        onDelta: (text) => received.push(`second:${text}`),
      }),
    ).toBe(true);

    expect(coordinator.getSnapshot().runningThreadIds).toEqual(["thread-1", "thread-2"]);

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-1",
      runId: "run-1",
      text: "still active",
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-2",
      runId: "run-2",
      text: "also active",
    } satisfies ChatRunEvent);

    expect(received).toEqual(["first:still active", "second:also active"]);
  });

  it("does not replace an active request in the same thread", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    expect(
      coordinator.beginRequest("request-1", "thread-1", {
        onDelta: (text) => received.push(`first:${text}`),
      }),
    ).toBe(true);
    expect(
      coordinator.beginRequest("request-2", "thread-1", {
        onDelta: (text) => received.push(`second:${text}`),
      }),
    ).toBe(false);

    expect(coordinator.getSnapshot().runningThreadIds).toEqual(["thread-1"]);

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-1",
      runId: "run-1",
      text: "still active",
    } satisfies ChatRunEvent);

    expect(received).toEqual(["first:still active"]);
  });

  it("stops the run for the requested thread only", () => {
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {});
    coordinator.beginRequest("request-2", "thread-2", {});
    coordinator.attachRunId("request-1", "run-1");
    coordinator.attachRunId("request-2", "run-2");

    expect(coordinator.getPendingRunId("thread-2")).toBe("run-2");
    expect(coordinator.getPendingRunId("thread-1")).toBe("run-1");
  });

  it("keeps other thread runs active when one thread completes", () => {
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {});
    coordinator.beginRequest("request-2", "thread-2", {});

    coordinator.handleEvent({
      type: "completed",
      requestKey: "request-1",
      runId: "run-1",
      text: "done",
      finishedAt: "2026-04-25T00:00:00.000Z",
    } satisfies ChatRunEvent);

    expect(coordinator.getSnapshot().isSending).toBe(true);
    expect(coordinator.getSnapshot().runningThreadIds).toEqual(["thread-2"]);
  });

  it("routes shell events to the active request callback", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {
      onShell: (shell) => received.push(`${shell.status}:${shell.command}`),
    });

    coordinator.handleEvent({
      type: "shell",
      requestKey: "request-1",
      runId: "run-1",
      shell: {
        id: "shell-1",
        command: "pwd",
        output: "",
        status: "running",
      },
    } satisfies ChatRunEvent);

    expect(received).toEqual(["running:pwd"]);
  });

  it("routes reasoning events to the active request callback", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];

    coordinator.beginRequest("request-1", "thread-1", {
      onReasoning: (reasoning) => received.push(`${reasoning.status}:${reasoning.content}`),
    });

    coordinator.handleEvent({
      type: "reasoning",
      runId: "run-1",
      requestKey: "request-1",
      reasoning: {
        id: "reasoning-1",
        content: "Need to inspect files",
        status: "running",
      },
    } satisfies ChatRunEvent);

    expect(received).toEqual(["running:Need to inspect files"]);
  });

  it("routes subagent-task events to the active request callback", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];

    coordinator.beginRequest("request-1", "thread-1", {
      onSubagentTask: (task) => received.push(`${task.status}:${task.description}`),
    });

    coordinator.handleEvent({
      type: "subagent-task",
      runId: "run-1",
      requestKey: "request-1",
      task: {
        id: "kimi-tool-1",
        runtimeId: "kimi",
        source: "agent",
        agentType: "coder",
        description: "Implement persistence",
        prompt: "Implement step 1 and report the result",
        background: false,
        status: "running",
        startedAt: 1000,
      },
    } satisfies ChatRunEvent);

    expect(received).toEqual(["running:Implement persistence"]);
  });

  it("routes Run Checklist lifecycle events to the active request", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];

    coordinator.beginRequest("request-1", "thread-1", {
      onStarted: (runId) => received.push(`started:${runId}`),
      onChecklist: (checklist) =>
        received.push(`${checklist.entries[0]?.status}:${checklist.entries[0]?.content}`),
      onComplete: (_text, runId, writtenFiles) =>
        received.push(`completed:${runId}:${writtenFiles?.join(",")}`),
    });

    coordinator.handleEvent({
      type: "started",
      runId: "run-1",
      requestKey: "request-1",
      threadId: "thread-1",
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "checklist",
      runId: "run-1",
      requestKey: "request-1",
      threadId: "thread-1",
      runtimeId: "kimi",
      checklist: {
        entries: [{ content: "Implement persistence", status: "in_progress" }],
      },
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "completed",
      runId: "run-1",
      requestKey: "request-1",
      text: "done",
      finishedAt: "2026-01-01T00:00:00.000Z",
      writtenFiles: ["src/checklist.ts"],
    } satisfies ChatRunEvent);

    expect(received).toEqual([
      "started:run-1",
      "in_progress:Implement persistence",
      "completed:run-1:src/checklist.ts",
    ]);
  });

  it("ignores a previous Run Checklist event after the next Run starts", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];

    coordinator.beginRequest("request-1", "thread-1", {
      onChecklist: (checklist) => received.push(checklist.entries[0]?.content ?? "empty"),
    });
    coordinator.handleEvent({
      type: "completed",
      runId: "run-1",
      requestKey: "request-1",
      text: "done",
      finishedAt: "2026-01-01T00:00:00.000Z",
    } satisfies ChatRunEvent);

    coordinator.beginRequest("request-2", "thread-1", {
      onChecklist: (checklist) => received.push(checklist.entries[0]?.content ?? "empty"),
    });
    coordinator.handleEvent({
      type: "started",
      runId: "run-2",
      requestKey: "request-2",
      threadId: "thread-1",
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "checklist",
      runId: "run-1",
      requestKey: "request-1",
      threadId: "thread-1",
      runtimeId: "kimi",
      checklist: { entries: [{ content: "Stale", status: "in_progress" }] },
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "checklist",
      runId: "run-2",
      requestKey: "request-2",
      threadId: "thread-1",
      runtimeId: "kimi",
      checklist: { entries: [{ content: "Current", status: "in_progress" }] },
    } satisfies ChatRunEvent);

    expect(received).toEqual(["Current"]);
  });

  it("rejects a mismatched run id even when the request key matches", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];
    coordinator.beginRequest("request-1", "thread-1", {
      onChecklist: (checklist) => received.push(checklist.entries[0]?.content ?? "empty"),
    });
    coordinator.handleEvent({
      type: "started",
      runId: "run-current",
      requestKey: "request-1",
      threadId: "thread-1",
    } satisfies ChatRunEvent);

    coordinator.handleEvent({
      type: "checklist",
      runId: "run-stale",
      requestKey: "request-1",
      threadId: "thread-1",
      runtimeId: "kimi",
      checklist: { entries: [{ content: "Stale", status: "in_progress" }] },
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "checklist",
      runId: "run-current",
      requestKey: "request-1",
      threadId: "thread-1",
      runtimeId: "kimi",
      checklist: { entries: [{ content: "Current", status: "in_progress" }] },
    } satisfies ChatRunEvent);

    expect(received).toEqual(["Current"]);
  });

  it("ignores subagent-task events from an unrelated run id", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];

    coordinator.beginRequest("request-1", "thread-1", {
      onSubagentTask: (task) => received.push(task.description),
    });

    coordinator.handleEvent({
      type: "subagent-task",
      runId: "run-2",
      requestKey: "request-2",
      task: {
        id: "kimi-tool-9",
        runtimeId: "kimi",
        source: "agent",
        description: "Wrong run",
        background: false,
        status: "running",
        startedAt: 1000,
      },
    } satisfies ChatRunEvent);

    expect(received).toEqual([]);
    expect(coordinator.getSnapshot().isSending).toBe(true);
  });

  it("tracks pending permission requests by thread", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];
    coordinator.beginRequest("req-1", "thread-1", {
      onPermissionRequested: (permission) => received.push(permission.id),
    });
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "req-1",
      permission: {
        id: "perm-1",
        runId: "run-1",
        requestKey: "req-1",
        threadId: "thread-1",
        provider: "claude-code",
        action: "edit",
        title: "Edit demo.txt",
        options: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      } satisfies ChatPermissionRequest,
    });

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingPermissions).toHaveLength(1);
    expect(snapshot.pendingPermissions[0].id).toBe("perm-1");
    expect(received).toEqual(["perm-1"]);
  });

  it("removes permission requests when resolved", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "req-1",
      permission: {
        id: "perm-1",
        runId: "run-1",
        requestKey: "req-1",
        threadId: "thread-1",
        provider: "claude-code",
        action: "edit",
        title: "Edit demo.txt",
        options: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      } satisfies ChatPermissionRequest,
    });

    coordinator.handleEvent({
      type: "permission-resolved",
      runId: "run-1",
      requestKey: "req-1",
      permissionId: "perm-1",
      optionId: "approve_once",
      optionName: "Approve once",
      optionKind: "allow_once",
    } satisfies ChatRunEvent);

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingPermissions).toHaveLength(0);
  });

  it("routes permission outcomes and Plan mode changes to the active request", () => {
    const coordinator = createChatRunCoordinator();
    const outcomes: string[] = [];
    coordinator.beginRequest("req-1", "thread-1", {
      onPermissionResolved: (resolution) =>
        outcomes.push(`${resolution.optionId}:${resolution.optionKind}`),
      onPlanModeChanged: (enabled) => outcomes.push(`plan:${enabled}`),
    });

    coordinator.handleEvent({
      type: "permission-resolved",
      runId: "run-1",
      requestKey: "req-1",
      permissionId: "perm-1",
      optionId: "plan_revise",
      optionName: "Revise",
      optionKind: "reject_once",
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "plan-mode-changed",
      runId: "run-1",
      requestKey: "req-1",
      enabled: false,
    } satisfies ChatRunEvent);

    expect(outcomes).toEqual(["plan_revise:reject_once", "plan:false"]);
  });

  it("reports pending Plan Reviews as interrupted when a run ends", () => {
    const coordinator = createChatRunCoordinator();
    const interrupted: string[] = [];
    coordinator.beginRequest("req-1", "thread-1", {
      onPermissionsInterrupted: (permissions) =>
        interrupted.push(...permissions.map((permission) => permission.id)),
    });

    coordinator.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "req-1",
      permission: {
        id: "perm-plan",
        runId: "run-1",
        requestKey: "req-1",
        threadId: "thread-1",
        provider: "kimi",
        action: "unknown",
        title: "Review plan",
        options: [{ optionId: "plan_approve", name: "Approve", kind: "allow_once" }],
        planReview: { content: "# Plan" },
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      },
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "stopped",
      runId: "run-1",
      requestKey: "req-1",
    } satisfies ChatRunEvent);

    expect(interrupted).toEqual(["perm-plan"]);
    expect(coordinator.getSnapshot().pendingPermissions).toEqual([]);
  });

  it("removes permission when permission-failed is received", () => {
    const received: string[] = [];
    const failedRunIds: Array<string | undefined> = [];
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {
      onError: (error, runId) => {
        received.push(error);
        failedRunIds.push(runId);
      },
    });
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "req-1",
      permission: {
        id: "perm-1",
        runId: "run-1",
        requestKey: "req-1",
        threadId: "thread-1",
        provider: "claude-code",
        action: "edit",
        title: "Edit demo.txt",
        options: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      } satisfies ChatPermissionRequest,
    });

    coordinator.handleEvent({
      type: "permission-failed",
      runId: "run-1",
      requestKey: "req-1",
      permissionId: "perm-1",
      error: "Interactive approvals not supported",
    });

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingPermissions).toHaveLength(0);
    expect(snapshot.lastError).toContain("not supported");
    expect(snapshot.isSending).toBe(false);
    expect(received).toEqual(["Interactive approvals not supported"]);
    expect(failedRunIds).toEqual(["run-1"]);
  });

  function makeQuestionEvent(overrides: Partial<ChatQuestionRequest> = {}): ChatQuestionRequest {
    return {
      id: "kimi-question-run-1-7",
      runId: "run-1",
      requestKey: "req-1",
      threadId: "thread-1",
      provider: "kimi",
      source: "native-acp",
      questions: [
        {
          header: "Language",
          question: "Which language should the new module use?",
          options: [
            { optionId: "opt_ts", label: "TypeScript" },
            { optionId: "opt_js", label: "JavaScript" },
          ],
          multiSelect: false,
        },
      ],
      skipOptionId: "opt_dismiss",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("tracks a pending question in the snapshot when one is requested", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingQuestions).toHaveLength(1);
    expect(snapshot.pendingQuestions[0]).toMatchObject({
      id: "kimi-question-run-1-7",
      runId: "run-1",
      threadId: "thread-1",
      source: "native-acp",
    });
  });

  it("removes the pending question when it is resolved", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "question-resolved",
      runId: "run-1",
      requestKey: "req-1",
      questionId: "kimi-question-run-1-7",
      outcome: "answered",
      optionId: "opt_ts",
      optionLabel: "TypeScript",
    } satisfies ChatRunEvent);

    expect(coordinator.getSnapshot().pendingQuestions).toHaveLength(0);
    expect(coordinator.getSnapshot().isSending).toBe(true);
  });

  it("clears pending questions when the run ends", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "stopped",
      runId: "run-1",
      requestKey: "req-1",
    } satisfies ChatRunEvent);

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingQuestions).toHaveLength(0);
    expect(snapshot.isSending).toBe(false);
  });

  it("surfaces a question failure without ending the run", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "question-failed",
      runId: "run-1",
      requestKey: "req-1",
      questionId: "kimi-question-run-1-7",
      error: "Question option is no longer available.",
    } satisfies ChatRunEvent);

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingQuestions).toHaveLength(1);
    expect(snapshot.lastError).toBe("Question option is no longer available.");
    expect(snapshot.isSending).toBe(true);
  });

  it("ignores a question failure for a question that is not pending", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "question-failed",
      runId: "run-1",
      requestKey: "req-1",
      questionId: "kimi-question-run-2-1",
      error: "Question request not found. The run may have already ended.",
    } satisfies ChatRunEvent);

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingQuestions).toHaveLength(1);
    expect(snapshot.lastError).toBe(null);
    expect(snapshot.isSending).toBe(true);
  });

  it("routes question requests and resolutions to the active request callbacks", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];
    coordinator.beginRequest("req-1", "thread-1", {
      onQuestionRequested: (question) => received.push(`requested:${question.id}`),
      onQuestionResolved: ({ question, outcome }) =>
        received.push(`resolved:${question.id}:${outcome}`),
    });
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "question-resolved",
      runId: "run-1",
      requestKey: "req-1",
      questionId: "kimi-question-run-1-7",
      outcome: "answered",
    } satisfies ChatRunEvent);

    expect(received).toEqual([
      "requested:kimi-question-run-1-7",
      "resolved:kimi-question-run-1-7:answered",
    ]);
    expect(coordinator.getSnapshot().pendingQuestions).toHaveLength(0);
  });

  it("reports pending questions as interrupted when a run ends", () => {
    const coordinator = createChatRunCoordinator();
    const interrupted: string[] = [];
    coordinator.beginRequest("req-1", "thread-1", {
      onQuestionsInterrupted: (questions) =>
        interrupted.push(...questions.map((question) => question.id)),
    });
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "stopped",
      runId: "run-1",
      requestKey: "req-1",
    } satisfies ChatRunEvent);

    expect(interrupted).toEqual(["kimi-question-run-1-7"]);
    expect(coordinator.getSnapshot().pendingQuestions).toEqual([]);
  });

  it("keeps a pending question attached to its thread while another thread runs", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "req-1",
      question: makeQuestionEvent(),
    } satisfies ChatRunEvent);

    // The user navigates to another Thread and starts a Run there; the
    // question stays attached to thread-1 instead of moving or cancelling.
    coordinator.beginRequest("req-2", "thread-2", {});
    coordinator.attachRunId("req-2", "run-2");

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingQuestions).toHaveLength(1);
    expect(snapshot.pendingQuestions[0].threadId).toBe("thread-1");

    coordinator.handleEvent({
      type: "question-resolved",
      runId: "run-1",
      requestKey: "req-1",
      questionId: "kimi-question-run-1-7",
      outcome: "skipped",
    } satisfies ChatRunEvent);

    expect(coordinator.getSnapshot().pendingQuestions).toHaveLength(0);
    expect(coordinator.getSnapshot().runningThreadIds).toEqual(["thread-1", "thread-2"]);
  });
});
