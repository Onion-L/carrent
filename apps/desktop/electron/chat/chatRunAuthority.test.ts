import { describe, expect, it } from "bun:test";

import type { ChatPermissionResponse } from "../../src/shared/chatPermissions";
import type { ChatQuestionResponse } from "../../src/shared/chatQuestions";
import type { ChatRunEvent, ChatTurnRequest } from "../../src/shared/chat";
import { createChatRunAuthority } from "./chatRunAuthority";

function request(runId = "run-1", threadId = "thread-1"): ChatTurnRequest {
  return {
    runId,
    requestKey: `request-${runId}`,
    context: {
      kind: "project",
      workingDirectory: "/repo",
      projectId: "project-1",
      workspaceId: "workspace-1",
    },
    threadId,
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
    transcript: [],
    message: "Implement it",
  };
}

function createHarness() {
  const starts: string[] = [];
  const stops: string[] = [];
  const permissions: ChatPermissionResponse[] = [];
  const questions: ChatQuestionResponse[] = [];
  const published: Array<{ subscriberId: number; revision: number }> = [];
  const authority = createChatRunAuthority({
    start: (runId) => starts.push(runId),
    stop: (runId) => stops.push(runId),
    respondToPermission: (response) => permissions.push(response),
    respondToQuestion: (response) => questions.push(response),
    publish: (subscriberId, state) => published.push({ subscriberId, revision: state.revision }),
  });
  return { authority, starts, stops, permissions, questions, published };
}

describe("createChatRunAuthority", () => {
  it("fans out Run events and gives a late subscriber the accumulated live state", () => {
    const { authority, published } = createHarness();
    authority.subscribe(1);
    expect(authority.send(request()).accepted).toBe(true);

    authority.handleEvent({
      type: "started",
      runId: "run-1",
      requestKey: "request-run-1",
      threadId: "thread-1",
    });
    authority.handleEvent({
      type: "delta",
      runId: "run-1",
      requestKey: "request-run-1",
      text: "hello",
    });

    const late = authority.subscribe(2);
    expect(late.runs).toHaveLength(1);
    expect(late.runs[0]).toMatchObject({
      runId: "run-1",
      threadId: "thread-1",
      status: "running",
    });
    expect(late.runs[0]?.events.map((event) => event.type)).toEqual(["started", "delta"]);
    expect(published.some((entry) => entry.subscriberId === 1)).toBe(true);

    authority.handleEvent({
      type: "reasoning",
      runId: "run-1",
      requestKey: "request-run-1",
      reasoning: { id: "reasoning-1", content: "Inspecting", status: "running" },
    });
    expect(published.at(-1)?.subscriberId).toBe(2);
  });

  it("keeps a Run alive when a Renderer unsubscribes or reloads", () => {
    const { authority, stops } = createHarness();
    authority.subscribe(1);
    authority.send(request());

    authority.unsubscribe(1);
    authority.handleEvent({
      type: "delta",
      runId: "run-1",
      requestKey: "request-run-1",
      text: "still running",
    });

    expect(stops).toEqual([]);
    expect(authority.subscribe(2).runs[0]?.events).toHaveLength(1);
    expect(authority.getState().runs[0]?.status).toBe("starting");
  });

  it("accepts only one concurrent send for a Thread", () => {
    const { authority, starts } = createHarness();

    const first = authority.send(request("run-1"));
    const second = authority.send(request("run-2"));

    expect(first).toMatchObject({ accepted: true, runId: "run-1" });
    expect(second).toMatchObject({ accepted: false, runId: "run-1" });
    expect(starts).toEqual(["run-1"]);
    expect(second.state.runs).toHaveLength(1);
  });

  it("accepts Stop once and returns the latest state for duplicate or stale requests", () => {
    const { authority, stops } = createHarness();
    authority.send(request());

    expect(authority.stop("run-1").accepted).toBe(true);
    expect(authority.stop("run-1").accepted).toBe(false);
    expect(authority.stop("run-stale").accepted).toBe(false);
    expect(stops).toEqual(["run-1"]);
    expect(authority.getState().runs[0]?.stopRequested).toBe(true);
  });

  it("accepts each pending Approval Request response once", () => {
    const { authority, permissions } = createHarness();
    authority.send(request());
    authority.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "request-run-1",
      permission: {
        id: "permission-1",
        runId: "run-1",
        requestKey: "request-run-1",
        threadId: "thread-1",
        provider: "kimi",
        action: "shell",
        title: "Run command",
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        createdAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:01:00.000Z",
      },
    });
    const response = { permissionId: "permission-1", runId: "run-1", optionId: "allow" };

    expect(authority.respondToPermission(response).accepted).toBe(true);
    expect(authority.respondToPermission(response).accepted).toBe(false);
    expect(authority.respondToPermission({ ...response, runId: "run-stale" }).accepted).toBe(false);
    expect(permissions).toEqual([response]);
  });

  it("accepts each pending user-question response once", () => {
    const { authority, questions } = createHarness();
    authority.send(request());
    authority.handleEvent({
      type: "question-requested",
      runId: "run-1",
      requestKey: "request-run-1",
      question: {
        id: "question-1",
        runId: "run-1",
        requestKey: "request-run-1",
        threadId: "thread-1",
        provider: "kimi",
        source: "native-acp",
        questions: [
          {
            header: "Choice",
            question: "Continue?",
            options: [{ optionId: "yes", label: "Yes" }],
            multiSelect: false,
          },
        ],
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    });
    const response: ChatQuestionResponse = {
      questionId: "question-1",
      runId: "run-1",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["yes"] }],
    };

    expect(authority.respondToQuestion(response).accepted).toBe(true);
    expect(authority.respondToQuestion(response).accepted).toBe(false);
    expect(questions).toEqual([response]);

    authority.handleEvent({
      type: "question-resolved",
      runId: "run-1",
      questionId: "question-1",
      outcome: "answered",
    });
    expect(authority.getState().runs[0]?.events.at(-1)).toMatchObject({
      type: "question-resolved",
      answers: response.answers,
    });
  });

  it("keeps a user question pending when the response does not match its options", () => {
    const { authority, questions } = createHarness();
    authority.send(request());
    authority.handleEvent({
      type: "question-requested",
      runId: "run-1",
      question: {
        id: "question-1",
        runId: "run-1",
        threadId: "thread-1",
        provider: "kimi",
        source: "native-acp",
        questions: [
          {
            header: "Choice",
            question: "Continue?",
            options: [{ optionId: "yes", label: "Yes" }],
            multiSelect: false,
          },
        ],
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    });

    const result = authority.respondToQuestion({
      questionId: "question-1",
      runId: "run-1",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["stale-option"] }],
    });

    expect(result.accepted).toBe(false);
    expect(result.state.runs[0]?.pendingQuestions).toHaveLength(1);
    expect(questions).toEqual([]);
  });

  it("clears pending interactions and keeps the terminal Run available for convergence", () => {
    const { authority } = createHarness();
    authority.send(request());
    authority.handleEvent({
      type: "question-requested",
      runId: "run-1",
      question: {
        id: "question-1",
        runId: "run-1",
        threadId: "thread-1",
        provider: "kimi",
        source: "native-acp",
        questions: [],
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    } satisfies ChatRunEvent);
    authority.handleEvent({
      type: "completed",
      runId: "run-1",
      text: "done",
      finishedAt: "2026-08-01T00:00:01.000Z",
    });

    expect(authority.getState().runs[0]).toMatchObject({
      status: "completed",
      pendingQuestions: [],
      pendingPermissions: [],
    });
  });
});
