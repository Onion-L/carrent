import { describe, expect, it } from "bun:test";
import { serialize } from "node:v8";

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
    batchIntervalMs: 0,
    publish: (subscriberId, state) => published.push({ subscriberId, revision: state.revision }),
  });
  return { authority, starts, stops, permissions, questions, published };
}

describe("createChatRunAuthority", () => {
  it("keeps cumulative IPC payload growth near-linear as streaming chunks double", () => {
    const measurePublishedBytes = (chunkCount: number, subscriberCount = 2) => {
      let publishedBytes = 0;
      const authority = createChatRunAuthority({
        start: () => {},
        stop: () => {},
        respondToPermission: () => {},
        respondToQuestion: () => {},
        batchIntervalMs: 0,
        publish: (_subscriberId, payload) => {
          publishedBytes += serialize(payload).byteLength;
        },
      });
      for (let subscriberId = 1; subscriberId <= subscriberCount; subscriberId += 1) {
        authority.subscribe(subscriberId);
      }

      ["run-1", "run-2"].forEach((runId, index) => {
        const threadId = `thread-${index + 1}`;
        authority.send(request(runId, threadId));
        authority.handleEvent({ type: "started", runId, threadId });
      });

      const accumulated = new Map<string, string>();
      for (let index = 0; index < chunkCount; index += 1) {
        ["run-1", "run-2"].forEach((runId) => {
          const content = `${accumulated.get(runId) ?? ""}${"x".repeat(16)}`;
          accumulated.set(runId, content);
          authority.handleEvent({
            type: "kimi-timeline",
            runId,
            item: {
              type: "message",
              id: `${runId}-message-1`,
              order: 0,
              content,
              isFinal: false,
            },
          });
          authority.handleEvent({
            type: "kimi-timeline",
            runId,
            item: {
              type: "thinking",
              id: `${runId}-thinking-1`,
              order: 1,
              content,
              status: "running",
            },
          });
          authority.handleEvent({
            type: "kimi-timeline",
            runId,
            item: {
              type: "tool",
              id: `${runId}-tool-1`,
              order: 2,
              toolCallId: `${runId}-tool-call-1`,
              title: "Shell",
              kind: "execute",
              command: "bun test",
              filePath: "",
              input: "",
              output: content,
              error: "",
              status: "running",
            },
          });
          authority.handleEvent({ type: "delta", runId, text: "x".repeat(16) });
        });
      }

      return publishedBytes;
    };

    const bytesAt50Chunks = measurePublishedBytes(50);
    const bytesAt100Chunks = measurePublishedBytes(100);
    const bytesAt200Chunks = measurePublishedBytes(200);

    expect(bytesAt100Chunks / bytesAt50Chunks).toBeLessThan(2.5);
    expect(bytesAt200Chunks / bytesAt100Chunks).toBeLessThan(2.5);
    expect(bytesAt50Chunks / measurePublishedBytes(50, 1)).toBe(2);
  });

  it("publishes revisioned updates and stores cumulative timeline items as patches", () => {
    const updates: Array<{ subscriberId: number; payload: unknown }> = [];
    const authority = createChatRunAuthority({
      start: () => {},
      stop: () => {},
      respondToPermission: () => {},
      respondToQuestion: () => {},
      batchIntervalMs: 0,
      publish: (subscriberId, payload) => updates.push({ subscriberId, payload }),
    });
    authority.subscribe(1);
    authority.subscribe(2);
    authority.send(request());
    authority.handleEvent({
      type: "kimi-timeline",
      runId: "run-1",
      item: {
        type: "message",
        id: "run-1-message-1",
        order: 0,
        content: "hello",
        isFinal: false,
      },
    });
    authority.handleEvent({ type: "delta", runId: "run-1", text: "hello" });
    authority.handleEvent({
      type: "kimi-timeline",
      runId: "run-1",
      item: {
        type: "message",
        id: "run-1-message-1",
        order: 0,
        content: "hello world",
        isFinal: true,
      },
    });
    authority.handleEvent({ type: "delta", runId: "run-1", text: " world" });

    expect(updates.at(-1)?.payload).toMatchObject({
      baseRevision: 2,
      revision: 3,
      run: { runId: "run-1", threadId: "thread-1" },
      event: {
        type: "kimi-timeline-update",
        update: {
          itemType: "message",
          id: "run-1-message-1",
          content: { kind: "append", value: " world" },
          isFinal: true,
        },
      },
    });
    const events = authority.getState().runs[0]?.events ?? [];
    expect(events[0]).toMatchObject({
      type: "kimi-timeline",
      item: { type: "message", content: "hello world", isFinal: true },
    });
    expect(events).toHaveLength(1);
    expect(authority.getState().runs[0]?.eventCount).toBe(2);
    expect(updates).toHaveLength(6);
  });

  it("batches high-frequency Run updates", async () => {
    const published: unknown[] = [];
    const authority = createChatRunAuthority({
      start: () => {},
      stop: () => {},
      respondToPermission: () => {},
      respondToQuestion: () => {},
      batchIntervalMs: 1,
      publish: (_subscriberId, update) => published.push(update),
    });
    authority.subscribe(1);
    authority.send(request());
    published.length = 0;

    authority.handleEvent({ type: "delta", runId: "run-1", text: "one" });
    authority.handleEvent({ type: "delta", runId: "run-1", text: "two" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(published).toHaveLength(1);
    const batch = published[0] as { baseRevision: number; revision: number; updates: unknown[] };
    expect(batch.baseRevision).toBe(1);
    expect(batch.revision).toBe(3);
    expect(batch.updates).toHaveLength(2);
  });

  it("keeps reconnect history materialized as chunk count grows", () => {
    const authority = createChatRunAuthority({
      start: () => {},
      stop: () => {},
      respondToPermission: () => {},
      respondToQuestion: () => {},
      batchIntervalMs: 0,
      publish: () => {},
    });
    authority.send(request());
    authority.handleEvent({ type: "started", runId: "run-1", threadId: "thread-1" });

    let content = "";
    for (let index = 0; index < 200; index += 1) {
      content += "x".repeat(16);
      authority.handleEvent({
        type: "kimi-timeline",
        runId: "run-1",
        item: {
          type: "message",
          id: "run-1-message-1",
          order: 0,
          content,
          isFinal: false,
        },
      });
      authority.handleEvent({ type: "delta", runId: "run-1", text: "x".repeat(16) });
    }

    const run = authority.getState().runs[0]!;
    expect(run.eventCount).toBe(201);
    expect(run.events).toHaveLength(2);
    expect(run.events.map((event) => event.type)).toEqual(["started", "kimi-timeline"]);
    expect(serialize(authority.subscribe(1)).byteLength).toBeLessThan(10_000);
  });

  it("fails a Run instead of publishing or replaying an oversized payload", () => {
    const stops: string[] = [];
    const updates: unknown[] = [];
    const authority = createChatRunAuthority({
      start: () => {},
      stop: (runId) => stops.push(runId),
      respondToPermission: () => {},
      respondToQuestion: () => {},
      batchIntervalMs: 0,
      publish: (_subscriberId, update) => updates.push(update),
      maxPayloadBytes: 1_024,
    });
    authority.subscribe(1);
    authority.send(request());
    authority.handleEvent({ type: "delta", runId: "run-1", text: "x".repeat(4_096) });

    expect(stops).toEqual(["run-1"]);
    expect(updates.at(-1)).toMatchObject({
      event: {
        type: "failed",
        error: "Run output exceeded the safe IPC replay limit.",
      },
      run: { status: "failed", stopRequested: true },
    });
    const replayEvents = authority.getState().runs[0]?.events ?? [];
    expect(replayEvents).toHaveLength(1);
    expect(replayEvents[0]).toMatchObject({ type: "failed" });
    expect(serialize(authority.subscribe(2)).byteLength).toBeLessThan(1_024);
  });

  it("keeps a bounded late-subscription snapshot read-only", () => {
    const published: unknown[] = [];
    const authority = createChatRunAuthority({
      start: () => {},
      stop: () => {},
      respondToPermission: () => {},
      respondToQuestion: () => {},
      batchIntervalMs: 0,
      publish: (_subscriberId, update) => published.push(update),
      maxPayloadBytes: 1_024,
    });

    ["run-1", "run-2", "run-3", "run-4"].forEach((runId, index) => {
      authority.send(request(runId, `thread-${index + 1}`));
      authority.handleEvent({ type: "delta", runId, text: runId.repeat(50) });
      authority.handleEvent({
        type: "completed",
        runId,
        text: "done".repeat(50),
        finishedAt: "2026-08-01T00:00:01.000Z",
      });
    });
    authority.send(request("active-run", "active-thread"));
    authority.handleEvent({ type: "delta", runId: "active-run", text: "still streaming" });
    const before = authority.getState();
    expect(serialize(before).byteLength).toBeGreaterThan(1_024);

    const snapshot = authority.subscribe(1);

    expect(serialize(snapshot).byteLength).toBeLessThanOrEqual(1_024);
    expect(snapshot.runs.map((run) => run.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "starting",
    ]);
    expect(snapshot.runs.at(-1)?.events).toMatchObject([
      { type: "text-snapshot", text: "still streaming" },
    ]);
    expect(authority.getState()).toEqual(before);
    expect(published).toEqual([]);
  });

  it("removes a terminal Run only after its logical watermark is persisted", () => {
    const { authority } = createHarness();
    authority.subscribe(1);
    authority.send(request());
    authority.handleEvent({ type: "delta", runId: "run-1", text: "complete text" });
    authority.handleEvent({
      type: "completed",
      runId: "run-1",
      text: "complete text",
      finishedAt: "2026-08-01T00:00:01.000Z",
    });

    expect(authority.acknowledgePersistedEvents("run-1", 1)).toBe(false);
    expect(authority.getState().runs[0]?.events.map((event) => event.type)).toEqual([
      "text-snapshot",
      "completed",
    ]);

    expect(authority.acknowledgePersistedEvents("run-1", 2)).toBe(true);
    expect(authority.getState().runs).toEqual([]);
    expect(authority.subscribe(2).runs).toEqual([]);
  });

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
    expect(late.runs[0]?.events.map((event) => event.type)).toEqual(["started", "text-snapshot"]);
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
    expect(authority.getState().runs).toHaveLength(1);
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
    expect(authority.getState().runs[0]?.pendingQuestions).toHaveLength(1);
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
    expect(authority.getState().runs[0]?.eventCount).toBe(2);
    expect(authority.getState().runs[0]?.events.map((event) => event.type)).toEqual([
      "question-requested",
      "completed",
    ]);
  });
});
