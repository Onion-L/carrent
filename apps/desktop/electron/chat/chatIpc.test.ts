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
    runtimeId: "kimi",
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
          getStatus: async () => null,
        },
      },
    );

    expect([...handlers.keys()].sort()).toEqual([
      "chat:kimi-status",
      "chat:permission-response",
      "chat:send",
      "chat:stop",
    ]);
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
          getStatus: async () => null,
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

  it("forwards attachments with the chat:send request", async () => {
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
          getStatus: async () => null,
        },
      },
    );

    const request = makeRequest({
      attachments: [
        {
          id: "a1",
          name: "ui.png",
          mimeType: "image/png",
          size: 1024,
          storageKey: "a1.png",
        },
      ],
    });

    const result = (await handlers.get("chat:send")?.({}, request)) as {
      runId: string;
    };
    expect(result.runId).toBeString();
    expect(started).toHaveLength(1);
    expect(started[0].request.attachments).toEqual(request.attachments);
  });

  it("rejects legacy runtimes before starting the session", async () => {
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
          getStatus: async () => null,
        },
      },
    );

    let error = "";
    try {
      await handlers.get("chat:send")?.({}, makeRequest({ runtimeId: "codex" }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    expect(error).toContain("unavailable in Carrent V1");
    expect(started).toHaveLength(0);
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
          getStatus: async () => null,
        },
      },
    );

    await handlers.get("chat:stop")?.({}, "run-123");
    expect(stopped).toEqual(["run-123"]);
  });

  it("chat:kimi-status returns null for non-kimi runtimes", async () => {
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
          getStatus: async () => ({
            model: "kimi-code/kimi-for-coding",
            used: 1000,
            total: 200000,
            percentage: 0.5,
          }),
        },
      },
    );

    const result = await handlers.get("chat:kimi-status")?.(
      {},
      makeRequest({ runtimeId: "codex" }),
    );
    expect(result).toBe(null);
  });

  it("chat:kimi-status forwards to the session manager for kimi", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const requested: ChatTurnRequest[] = [];

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
          getStatus: async (request) => {
            requested.push(request);
            return {
              model: "kimi-code/kimi-for-coding",
              used: 21169,
              total: 262144,
              percentage: 8.1,
            };
          },
        },
      },
    );

    const request = makeRequest({ runtimeId: "kimi" });
    const result = await handlers.get("chat:kimi-status")?.({}, request);
    expect(requested).toHaveLength(1);
    expect(requested[0].threadId).toBe("thread-1");
    expect(result).toEqual({
      model: "kimi-code/kimi-for-coding",
      used: 21169,
      total: 262144,
      percentage: 8.1,
    });
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
          getStatus: async () => null,
        },
      },
    );

    const responses: unknown[] = [];

    await handlers.get("chat:permission-response")?.(
      {},
      {
        runId: "run-1",
        permissionId: "perm-1",
        decision: "approved",
      },
    );

    expect(responses).toEqual([
      {
        runId: "run-1",
        permissionId: "perm-1",
        decision: "approved",
      },
    ]);
  });
});
