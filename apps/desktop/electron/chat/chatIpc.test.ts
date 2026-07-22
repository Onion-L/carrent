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
    planMode: false,
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          getStatus: async () => null,
        },
      },
    );

    expect([...handlers.keys()].sort()).toEqual([
      "chat:delete-thread-data",
      "chat:kimi-status",
      "chat:permission-response",
      "chat:send",
      "chat:stop",
    ]);
  });

  it("validates and forwards thread data deletion", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const deleted: unknown[] = [];

    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          deleteThreadData: async (request) => {
            deleted.push(request);
          },
          respondToPermission: () => {},
          getStatus: async () => null,
        },
      },
    );

    await handlers.get("chat:delete-thread-data")?.(
      {},
      { threadIds: ["thread-1"], attachmentStorageKeys: ["attachment.png"] },
    );

    expect(deleted).toEqual([
      { threadIds: ["thread-1"], attachmentStorageKeys: ["attachment.png"] },
    ]);
  });

  it("rejects malformed thread data deletion requests", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const deleted: unknown[] = [];

    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          deleteThreadData: async (request) => {
            deleted.push(request);
          },
          respondToPermission: () => {},
          getStatus: async () => null,
        },
      },
    );

    const invalidRequests = [
      null,
      {},
      { threadIds: [], attachmentStorageKeys: [] },
      { threadIds: [""], attachmentStorageKeys: [] },
      { threadIds: ["thread-1"], attachmentStorageKeys: [" "] },
      { threadIds: "thread-1", attachmentStorageKeys: [] },
      {
        threadIds: Array.from({ length: 10_001 }, (_, index) => `thread-${index}`),
        attachmentStorageKeys: [],
      },
    ];
    for (const request of invalidRequests) {
      let error: unknown;
      try {
        await handlers.get("chat:delete-thread-data")?.({}, request);
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error ? error.message : String(error)).toContain("Invalid");
    }
    expect(deleted).toHaveLength(0);
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
          deleteThreadData: async () => {},
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          getStatus: async () => null,
        },
      },
    );

    const request = makeRequest({
      attachments: [
        {
          id: "a1",
          kind: "image" as const,
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

  describe("chat:send attachment validation", () => {
    function registerCapture() {
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
            deleteThreadData: async () => {},
            respondToPermission: () => {},
            getStatus: async () => null,
          },
        },
      );

      return { handlers, started };
    }

    const validAttachment = {
      id: "a1",
      kind: "file" as const,
      name: "main.ts",
      mimeType: "text/plain",
      size: 512,
      storageKey: "a1.ts",
    };

    async function expectRejected(attachments: unknown) {
      const { handlers, started } = registerCapture();

      let error: unknown;
      try {
        await handlers.get("chat:send")?.({}, makeRequest({ attachments: attachments as never }));
      } catch (caught) {
        error = caught;
      }

      expect(error instanceof Error ? error.message : String(error)).toContain("Invalid");
      expect(started).toHaveLength(0);
    }

    it("rejects more than 30 attachments", async () => {
      await expectRejected(
        Array.from({ length: 31 }, (_, index) => ({
          ...validAttachment,
          id: `a${index}`,
          storageKey: `a${index}.ts`,
        })),
      );
    });

    it("rejects a single attachment over 10 MB", async () => {
      await expectRejected([{ ...validAttachment, size: 10 * 1024 * 1024 + 1 }]);
    });

    it("rejects a total size over 100 MB", async () => {
      await expectRejected(
        Array.from({ length: 11 }, (_, index) => ({
          ...validAttachment,
          id: `a${index}`,
          storageKey: `a${index}.ts`,
          size: 10 * 1024 * 1024,
        })),
      );
    });

    it("rejects an invalid kind", async () => {
      await expectRejected([{ ...validAttachment, kind: "document" }]);
    });

    it("rejects unsafe storage keys", async () => {
      await expectRejected([{ ...validAttachment, storageKey: "../workspace.json" }]);
      await expectRejected([{ ...validAttachment, storageKey: "a/b.ts" }]);
    });

    it("rejects a renderer-supplied localPath", async () => {
      await expectRejected([{ ...validAttachment, localPath: "/tmp/evil" }]);
    });

    it("rejects empty or unbounded metadata fields", async () => {
      await expectRejected([{ ...validAttachment, id: "" }]);
      await expectRejected([{ ...validAttachment, name: "  " }]);
      await expectRejected([{ ...validAttachment, mimeType: "" }]);
      await expectRejected([{ ...validAttachment, size: Number.NaN }]);
      await expectRejected([{ ...validAttachment, size: -1 }]);
    });

    it("sanitizes entries to the declared metadata fields", async () => {
      const { handlers, started } = registerCapture();

      await handlers.get("chat:send")?.(
        {},
        makeRequest({
          attachments: [
            {
              ...validAttachment,
              width: 640,
              height: 480,
              bytes: "raw",
              extra: "dropped",
            } as never,
          ],
        }),
      );

      expect(started).toHaveLength(1);
      expect(started[0].request.attachments).toEqual([
        {
          id: "a1",
          kind: "file",
          name: "main.ts",
          mimeType: "text/plain",
          size: 512,
          storageKey: "a1.ts",
          width: 640,
          height: 480,
        },
      ]);
    });
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
          deleteThreadData: async () => {},
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
          deleteThreadData: async () => {},
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
          deleteThreadData: async () => {},
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
          deleteThreadData: async () => {},
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

  it("chat:permission-response forwards selected options to the session manager", async () => {
    const handlers = new Map<string, Function>();

    registerChatIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          deleteThreadData: async () => {},
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
        optionId: "approve_once",
      },
    );

    expect(responses).toEqual([
      {
        runId: "run-1",
        permissionId: "perm-1",
        optionId: "approve_once",
      },
    ]);
  });
});
