import { describe, expect, it } from "bun:test";

import type { ChatRunAuthorityState, ChatRunEvent } from "../../shared/chat";
import type { ChatPermissionRequest } from "../../shared/chatPermissions";
import type { ChatQuestionRequest } from "../../shared/chatQuestions";
import { createChatRunCoordinator } from "./useChatRun";

describe("createChatRunCoordinator", () => {
  function makePermissionEvent(): ChatPermissionRequest {
    return {
      id: "permission-1",
      runId: "run-1",
      requestKey: "request-1",
      threadId: "thread-1",
      provider: "kimi",
      action: "shell",
      title: "Run command",
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:01:00.000Z",
    };
  }

  it("keeps two Renderer clients synchronized from shared Run snapshots", () => {
    const first = createChatRunCoordinator();
    const second = createChatRunCoordinator();
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const callbacks = (received: string[]) => ({
      onDelta: (text: string) => received.push(`delta:${text}`),
      onReasoning: (reasoning: { content: string }) =>
        received.push(`reasoning:${reasoning.content}`),
      onShell: (shell: { command: string }) => received.push(`shell:${shell.command}`),
      onSubagentTask: (task: { description: string }) => received.push(`task:${task.description}`),
      onChecklist: (checklist: { entries: Array<{ content: string }> }) =>
        received.push(`checklist:${checklist.entries[0]?.content}`),
      onPermissionRequested: (permission: { id: string }) =>
        received.push(`approval:${permission.id}`),
      onQuestionRequested: (question: { id: string }) => received.push(`question:${question.id}`),
      onComplete: (text: string) => received.push(`complete:${text}`),
    });
    first.beginRequest("request-1", "thread-1", callbacks(receivedA));
    second.observeThread("thread-1", callbacks(receivedB));
    const events: ChatRunEvent[] = [
      { type: "started", runId: "run-1", requestKey: "request-1", threadId: "thread-1" },
      { type: "delta", runId: "run-1", requestKey: "request-1", text: "hello" },
      {
        type: "reasoning",
        runId: "run-1",
        requestKey: "request-1",
        reasoning: { id: "reasoning-1", content: "Inspect", status: "running" },
      },
      {
        type: "shell",
        runId: "run-1",
        requestKey: "request-1",
        shell: { id: "shell-1", command: "bun test", output: "", status: "running" },
      },
      {
        type: "subagent-task",
        runId: "run-1",
        requestKey: "request-1",
        task: {
          id: "task-1",
          runtimeId: "kimi",
          source: "agent",
          description: "Review",
          background: false,
          status: "running",
          startedAt: 1,
        },
      },
      {
        type: "checklist",
        runId: "run-1",
        requestKey: "request-1",
        threadId: "thread-1",
        runtimeId: "kimi",
        checklist: { entries: [{ content: "Implement", status: "in_progress" }] },
      },
      {
        type: "permission-requested",
        runId: "run-1",
        requestKey: "request-1",
        permission: makePermissionEvent(),
      },
      {
        type: "question-requested",
        runId: "run-1",
        requestKey: "request-1",
        question: makeQuestionEvent(),
      },
    ];
    const state: ChatRunAuthorityState = {
      revision: 1,
      runs: [
        {
          runId: "run-1",
          threadId: "thread-1",
          requestKey: "request-1",
          status: "waiting-for-approval",
          stopRequested: false,
          events,
          pendingPermissions: [makePermissionEvent()],
          pendingQuestions: [makeQuestionEvent()],
        },
      ],
    };

    first.applyAuthorityState(state);
    second.applyAuthorityState(state);

    expect(first.getSnapshot()).toEqual(second.getSnapshot());
    expect(first.getSnapshot().runningThreadIds).toEqual(["thread-1"]);
    expect(first.getSnapshot().pendingPermissions).toHaveLength(1);
    expect(first.getSnapshot().pendingQuestions).toHaveLength(1);
    expect(receivedA).toEqual(receivedB);
    expect(receivedB).toEqual([
      "delta:hello",
      "reasoning:Inspect",
      "shell:bun test",
      "task:Review",
      "checklist:Implement",
      "approval:permission-1",
      "question:kimi-question-run-1-7",
    ]);

    const completed: ChatRunAuthorityState = {
      revision: 2,
      runs: [
        {
          ...state.runs[0]!,
          status: "completed",
          pendingPermissions: [],
          pendingQuestions: [],
          events: [
            ...events,
            {
              type: "completed",
              runId: "run-1",
              requestKey: "request-1",
              text: "done",
              finishedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        },
      ],
    };
    first.applyAuthorityState(completed);
    second.applyAuthorityState(completed);

    expect(receivedA.at(-1)).toBe("complete:done");
    expect(receivedB.at(-1)).toBe("complete:done");
    expect(second.getSnapshot().runningThreadIds).toEqual([]);
  });

  it("resumes an observer after its persisted event count", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];
    const appliedCounts: number[] = [];
    const callbackOrder: string[] = [];
    coordinator.applyAuthorityState({
      revision: 1,
      runs: [
        {
          runId: "run-1",
          threadId: "thread-1",
          requestKey: "request-1",
          status: "running",
          stopRequested: false,
          pendingPermissions: [],
          pendingQuestions: [],
          events: [
            { type: "started", runId: "run-1", threadId: "thread-1" },
            { type: "delta", runId: "run-1", text: "already persisted" },
            { type: "delta", runId: "run-1", text: " new" },
          ],
        },
      ],
    });

    coordinator.observeThread(
      "thread-1",
      {
        onDelta: (text) => {
          received.push(text);
          callbackOrder.push("delta");
        },
        onEventApplied: (count) => {
          appliedCounts.push(count);
          callbackOrder.push("progress");
        },
      },
      2,
    );

    expect(received).toEqual([" new"]);
    expect(appliedCounts).toEqual([3]);
    expect(callbackOrder).toEqual(["delta", "progress"]);
  });

  it("replays a terminal event that arrived while no observer was subscribed", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];
    const appliedCounts: number[] = [];
    coordinator.applyAuthorityState({
      revision: 1,
      runs: [
        {
          runId: "run-1",
          threadId: "thread-1",
          requestKey: "request-1",
          status: "completed",
          stopRequested: false,
          pendingPermissions: [],
          pendingQuestions: [],
          events: [
            { type: "started", runId: "run-1", threadId: "thread-1" },
            { type: "delta", runId: "run-1", text: "partial" },
            {
              type: "completed",
              runId: "run-1",
              text: "partial result",
              finishedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    coordinator.observeThread(
      "thread-1",
      {
        onComplete: (text) => received.push(text),
        onEventApplied: (count) => appliedCounts.push(count),
      },
      2,
    );

    expect(received).toEqual(["partial result"]);
    expect(appliedCounts).toEqual([3]);
  });

  it("resolves a persisted question after an observer reconnects", () => {
    const coordinator = createChatRunCoordinator();
    const question = makeQuestionEvent();
    const outcomes: string[] = [];
    coordinator.applyAuthorityState({
      revision: 1,
      runs: [
        {
          runId: "run-1",
          threadId: "thread-1",
          requestKey: "request-1",
          status: "running",
          stopRequested: false,
          pendingPermissions: [],
          pendingQuestions: [],
          events: [
            { type: "started", runId: "run-1", threadId: "thread-1" },
            { type: "question-requested", runId: "run-1", question },
            {
              type: "question-resolved",
              runId: "run-1",
              questionId: question.id,
              outcome: "answered",
              answers: [{ questionIndex: 0, optionIds: ["opt_ts"] }],
            },
          ],
        },
      ],
    });

    coordinator.observeThread(
      "thread-1",
      {
        onQuestionRequested: () => outcomes.push("requested-again"),
        onQuestionResolved: ({ question: resolvedQuestion, outcome, answers }) =>
          outcomes.push(`${resolvedQuestion.id}:${outcome}:${answers?.[0]?.optionIds.join(",")}`),
      },
      2,
    );

    expect(outcomes).toEqual([`${question.id}:answered:opt_ts`]);
  });

  it("interrupts a persisted question when a reloaded observer receives completion", () => {
    const coordinator = createChatRunCoordinator();
    const question = makeQuestionEvent();
    const interrupted: string[] = [];
    coordinator.applyAuthorityState({
      revision: 1,
      runs: [
        {
          runId: "run-1",
          threadId: "thread-1",
          status: "completed",
          stopRequested: false,
          pendingPermissions: [],
          pendingQuestions: [],
          events: [
            { type: "started", runId: "run-1", threadId: "thread-1" },
            { type: "question-requested", runId: "run-1", question },
            {
              type: "completed",
              runId: "run-1",
              text: "done",
              finishedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    coordinator.observeThread(
      "thread-1",
      {
        onQuestionsInterrupted: (questions) =>
          interrupted.push(...questions.map((item) => item.id)),
      },
      2,
    );

    expect(interrupted).toEqual([question.id]);
  });

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

  it("routes a runtime session notice without ending the run", () => {
    const notices: string[] = [];
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("request-1", "thread-1", {
      onNotice: (message) => notices.push(message),
    });

    coordinator.handleEvent({
      type: "notice",
      requestKey: "request-1",
      runId: "run-1",
      message: "Invalid Runtime Session mapping was removed. A new session was started.",
    } satisfies ChatRunEvent);

    expect(notices).toEqual([
      "Invalid Runtime Session mapping was removed. A new session was started.",
    ]);
    expect(coordinator.getSnapshot().isSending).toBe(true);
  });

  it("forwards Runtime Session recovery details with a failed run", () => {
    const recoveries: unknown[] = [];
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("request-1", "thread-1", {
      onError: (_error, _runId, _writtenFiles, recovery) => recoveries.push(recovery),
    });

    coordinator.handleEvent({
      type: "failed",
      requestKey: "request-1",
      runId: "run-1",
      error: "Session not found",
      runtimeSessionRecovery: { runtimeId: "kimi", threadId: "thread-1" },
    } satisfies ChatRunEvent);

    expect(recoveries).toEqual([{ runtimeId: "kimi", threadId: "thread-1" }]);
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

  it("routes normalized Kimi timeline updates through the Run event channel", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];

    coordinator.beginRequest("request-1", "thread-1", {
      onKimiTimeline: (item) =>
        received.push(
          "content" in item ? `${item.order}:${item.type}:${item.content}` : `${item.order}:${item.type}`,
        ),
    });
    const event = {
      type: "kimi-timeline",
      runId: "run-1",
      requestKey: "request-1",
      item: {
        type: "thinking",
        id: "kimi-run-1-thinking-1",
        order: 0,
        content: "Inspect files",
        status: "running",
      },
    } as const satisfies ChatRunEvent;

    coordinator.handleEvent(event);
    coordinator.handleEvent(event);

    expect(received).toEqual(["0:thinking:Inspect files", "0:thinking:Inspect files"]);
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
