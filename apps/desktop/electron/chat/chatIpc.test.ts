import { describe, expect, it } from "bun:test";
import type { ChatTurnRequest } from "../../src/shared/chat";
import { registerChatIpc } from "./chatIpc";

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    workspace: {
      kind: "project",
      projectId: "timbre",
      projectPath: "/Users/onion/workbench/timbre",
    },
    threadId: "thread-1",
    runtimeId: "codex",
    agent: {
      id: "architect",
      name: "Architect",
      responsibility: "You are an architect.",
    },
    runtimeMode: "approval-required",
    transcript: [],
    message: "Hello",
    ...overrides,
  };
}

describe("registerChatIpc", () => {
  it("registers chat:send and chat:stop channels", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerChatIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          respondToPermission: () => {},
        },
      },
    );

    expect([...handlers.keys()].sort()).toEqual(["chat:permission-response", "chat:send", "chat:stop"]);
  });

  it("chat:send returns a runId and starts the session", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const started: { runId: string; request: ChatTurnRequest }[] = [];

    registerChatIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        sessionManager: {
          start: (runId, request) => {
            started.push({ runId, request });
          },
          stop: () => {},
          respondToPermission: () => {},
        },
      },
    );

    const result = (await handlers.get("chat:send")?.({}, makeRequest())) as {
      runId: string;
    };
    expect(result.runId).toBeString();
    expect(started).toHaveLength(1);
    expect(started[0].request.message).toBe("Hello");
  });

  it("chat:stop calls session manager stop", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const stopped: string[] = [];

    registerChatIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        sessionManager: {
          start: () => {},
          stop: (runId) => {
            stopped.push(runId);
          },
          respondToPermission: () => {},
        },
      },
    );

    await handlers.get("chat:stop")?.({}, "run-123");
    expect(stopped).toEqual(["run-123"]);
  });

  it("chat:permission-response forwards decisions to the session manager", async () => {
    const handlers = new Map<string, Function>();

    registerChatIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          respondToPermission: (response) => responses.push(response),
        },
      },
    );

    const responses: unknown[] = [];

    await handlers.get("chat:permission-response")?.({}, {
      runId: "run-1",
      permissionId: "perm-1",
      decision: "approved",
    });

    expect(responses).toEqual([
      {
        runId: "run-1",
        permissionId: "perm-1",
        decision: "approved",
      },
    ]);
  });
});
