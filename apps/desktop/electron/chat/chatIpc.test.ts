import { describe, expect, it } from "bun:test";
import type { ChatTurnRequest } from "../../src/shared/chat";
import { registerChatIpc as registerProductionChatIpc } from "./chatIpc";
import { createChatRunAuthority } from "./chatRunAuthority";

function registerChatIpc(
  ipcMainLike: Parameters<typeof registerProductionChatIpc>[0],
  services: Omit<Parameters<typeof registerProductionChatIpc>[1], "runAuthority"> & {
    runAuthority?: Parameters<typeof registerProductionChatIpc>[1]["runAuthority"];
  },
) {
  const state = { revision: 0, runs: [] };
  const runAuthority =
    services.runAuthority ??
    ({
      getState: () => state,
      subscribe: () => state,
      unsubscribe: () => {},
      acknowledgePersistedEvents: () => false,
      send: (request: ChatTurnRequest) => {
        services.sessionManager.start(request.runId!, request);
        return { accepted: true, runId: request.runId, state };
      },
      stop: (runId: string) => {
        services.sessionManager.stop(runId);
        return { accepted: true, runId, state };
      },
      respondToPermission: (response) => {
        services.sessionManager.respondToPermission(response);
        return { accepted: true, runId: response.runId, state };
      },
      respondToQuestion: (response) => {
        services.sessionManager.respondToQuestion(response);
        return { accepted: true, runId: response.runId, state };
      },
      handleEvent: () => {},
    } satisfies Parameters<typeof registerProductionChatIpc>[1]["runAuthority"]);
  registerProductionChatIpc(ipcMainLike, { ...services, runAuthority });
}

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    context: {
      kind: "project",
      workspaceId: "workspace-1",
      projectId: "timbre",
      workingDirectory: "/Users/onion/workbench/timbre",
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
  it("routes shared Run subscriptions and commands through the Main authority", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const starts: string[] = [];
    const stops: string[] = [];
    const sessionManager = {
      start: (runId: string) => starts.push(runId),
      stop: (runId: string) => stops.push(runId),
      removeRuntimeSession: async () => {},
      deleteThreadData: async () => {},
      respondToPermission: () => {},
      respondToQuestion: () => {},
      shutdown: async () => {},
      getStatus: async () => null,
    };
    const runAuthority = createChatRunAuthority({
      start: sessionManager.start,
      stop: sessionManager.stop,
      respondToPermission: sessionManager.respondToPermission,
      respondToQuestion: sessionManager.respondToQuestion,
      publish: () => {},
    });
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { sessionManager, runAuthority },
    );

    expect(await handlers.get("chat:subscribe")?.({ sender: { id: 7 } })).toEqual({
      revision: 0,
      runs: [],
    });
    const first = await handlers.get("chat:send")?.(
      { sender: { id: 7 } },
      makeRequest({ runId: "run-1", requestKey: "request-1" }),
    );
    const raced = await handlers.get("chat:send")?.(
      { sender: { id: 8 } },
      makeRequest({ runId: "run-2", requestKey: "request-2" }),
    );
    const stopped = await handlers.get("chat:stop")?.({ sender: { id: 8 } }, "run-1");
    const staleStop = await handlers.get("chat:stop")?.({ sender: { id: 7 } }, "run-1");

    expect(first).toMatchObject({ accepted: true, runId: "run-1" });
    expect(raced).toMatchObject({ accepted: false, runId: "run-1" });
    expect(stopped).toMatchObject({ accepted: true, runId: "run-1" });
    expect(staleStop).toMatchObject({ accepted: false, runId: "run-1" });
    expect(starts).toEqual(["run-1"]);
    expect(stops).toEqual(["run-1"]);

    await handlers.get("chat:unsubscribe")?.({ sender: { id: 7 } });
  });

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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );

    expect([...handlers.keys()].sort()).toEqual([
      "chat:delete-thread-data",
      "chat:delete-thread-transaction",
      "chat:kimi-status",
      "chat:permission-response",
      "chat:question-response",
      "chat:remove-runtime-session",
      "chat:send",
      "chat:session-status",
      "chat:stop",
      "chat:subscribe",
      "chat:thread-action",
      "chat:unsubscribe",
    ]);
  });

  it("validates and forwards a Thread Action", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const requests: import("../../src/shared/threadActions").ThreadActionRequest[] = [];
    registerChatIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
          executeThreadAction: async (request) => {
            requests.push(request);
            return { ...request, completedAt: "2026-07-27T08:02:00.000Z" };
          },
        },
      },
    );

    await handlers.get("chat:thread-action")!(null, {
      action: "compact",
      threadId: "thread-1",
      runtimeId: "kimi",
      workingDirectory: "/repo",
    });

    expect(requests).toEqual([
      {
        action: "compact",
        threadId: "thread-1",
        runtimeId: "kimi",
        workingDirectory: "/repo",
      },
    ]);
  });

  it("validates and forwards Runtime Session removal", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const removed: unknown[] = [];
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async (request) => {
            removed.push(request);
          },
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );

    await handlers.get("chat:remove-runtime-session")?.(
      {},
      { runtimeId: "kimi", threadId: "thread-1" },
    );

    expect(removed).toEqual([{ runtimeId: "kimi", threadId: "thread-1" }]);
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async (request) => {
            deleted.push(request);
          },
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
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

  it("validates and forwards an atomic thread deletion transaction", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const deleted: unknown[] = [];
    const appState = {
      version: 1,
      workspaces: [],
      projects: [],
      associations: [],
      activeWorkspaceId: null,
    };
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
        },
        threadDeletionManager: {
          deleteThread: async (request) => {
            deleted.push(request);
          },
        },
      },
    );

    await handlers.get("chat:delete-thread-transaction")?.(
      {},
      {
        beforeAppState: appState,
        afterAppState: appState,
        threadData: { threadIds: ["thread-1"], attachmentStorageKeys: [] },
      },
    );
    await handlers.get("chat:delete-thread-transaction")?.(
      {},
      {
        beforeAppState: appState,
        afterAppState: appState,
        threadData: { threadIds: [], attachmentStorageKeys: [] },
        scope: {
          kind: "association",
          workspaceId: "workspace-1",
          projectId: "project-1",
        },
      },
    );

    expect(deleted).toEqual([
      {
        beforeAppState: appState,
        afterAppState: appState,
        threadData: { threadIds: ["thread-1"], attachmentStorageKeys: [] },
      },
      {
        beforeAppState: appState,
        afterAppState: appState,
        threadData: { threadIds: [], attachmentStorageKeys: [] },
        scope: {
          kind: "association",
          workspaceId: "workspace-1",
          projectId: "project-1",
        },
      },
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async (request) => {
            deleted.push(request);
          },
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
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

  it("blocks a Project Run when its recorded Working Directory is unavailable", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const started: unknown[] = [];
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: (...args) => started.push(args),
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
        },
        isProjectDirectoryAvailable: async () => false,
      },
    );

    let error: unknown;
    try {
      await handlers.get("chat:send")?.({}, makeRequest());
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof Error ? error.message : String(error)).toBe(
      "Project Working Directory is unavailable.",
    );
    expect(started).toHaveLength(0);
  });

  it("forwards stable Thread identity and Project Working Directory with its reserved Run ID", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const started: { runId: string; request: ChatTurnRequest }[] = [];
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: (runId, request) => started.push({ runId, request }),
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );
    const request = makeRequest({
      runId: "run-draft-1",
      context: {
        kind: "project",
        workspaceId: "workspace-1",
        projectId: "project-1",
        workingDirectory: "/code/carrent",
      },
      threadId: "thread-1",
    });

    const result = await handlers.get("chat:send")?.({}, request);

    expect(result).toMatchObject({ accepted: true, runId: "run-draft-1" });
    expect(started).toEqual([{ runId: "run-draft-1", request }]);
  });

  it("rejects a malformed reserved Run ID", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const started: unknown[] = [];
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: (...args) => started.push(args),
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );

    let error: unknown;
    try {
      await handlers.get("chat:send")?.({}, makeRequest({ runId: " bad " }));
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof Error ? error.message : String(error)).toBe("Invalid run ID.");
    expect(started).toHaveLength(0);
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
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
            removeRuntimeSession: async () => {},
            deleteThreadData: async () => {},
            respondToPermission: () => {},
            respondToQuestion: () => {},
            shutdown: async () => {},
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => ({
            sessionId: "session-status",
            model: "kimi-code/kimi-for-coding",
            used: 1000,
            total: 200000,
            percentage: 0.5,
            supportedCommands: ["status"],
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async (request) => {
            requested.push(request);
            return {
              sessionId: "session-status",
              model: "kimi-code/kimi-for-coding",
              used: 21169,
              total: 262144,
              percentage: 8.1,
              supportedCommands: ["status"],
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
      sessionId: "session-status",
      model: "kimi-code/kimi-for-coding",
      used: 21169,
      total: 262144,
      percentage: 8.1,
      supportedCommands: ["status"],
    });
  });

  it("chat:session-status forwards explicit inspection without using normal chat sending", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const requested: ChatTurnRequest[] = [];
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: async () => {},
          getStatus: async () => null,
          inspectStatus: async (request) => {
            requested.push(request);
            return {
              sessionId: "session-status",
              used: 35193,
              total: 1048576,
              percentage: 3.4,
              supportedCommands: ["status"],
            };
          },
        },
      },
    );

    const request = makeRequest();
    expect(await handlers.get("chat:session-status")?.({}, request)).toMatchObject({
      sessionId: "session-status",
      used: 35193,
    });
    expect(requested).toEqual([request]);
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
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: (response) => responses.push(response),
          respondToQuestion: () => {},
          shutdown: async () => {},
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

  it("chat:question-response forwards a submit answer to the session manager", async () => {
    const handlers = new Map<string, Function>();
    const responses: unknown[] = [];

    registerChatIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );

    await handlers.get("chat:question-response")?.(
      {},
      {
        runId: "run-1",
        questionId: "kimi-question-run-1-7",
        action: "submit",
        answers: [
          { questionIndex: 0, optionIds: ["opt_ts"] },
          { questionIndex: 1, optionIds: ["opt_logging", "opt_tracing"] },
        ],
      },
    );

    expect(responses).toEqual([
      {
        runId: "run-1",
        questionId: "kimi-question-run-1-7",
        action: "submit",
        answers: [
          { questionIndex: 0, optionIds: ["opt_ts"] },
          { questionIndex: 1, optionIds: ["opt_logging", "opt_tracing"] },
        ],
      },
    ]);
  });

  it("chat:question-response forwards an Other submit with custom text", async () => {
    const handlers = new Map<string, Function>();
    const responses: unknown[] = [];

    registerChatIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );

    await handlers.get("chat:question-response")?.(
      {},
      {
        runId: "run-1",
        questionId: "kimi-question-run-1-7",
        action: "submit",
        answers: [{ questionIndex: 0, optionIds: ["other"], customText: "Use Python instead" }],
      },
    );

    expect(responses).toEqual([
      {
        runId: "run-1",
        questionId: "kimi-question-run-1-7",
        action: "submit",
        answers: [{ questionIndex: 0, optionIds: ["other"], customText: "Use Python instead" }],
      },
    ]);
  });

  it("chat:question-response forwards a skip to the session manager", async () => {
    const handlers = new Map<string, Function>();
    const responses: unknown[] = [];

    registerChatIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );

    await handlers.get("chat:question-response")?.(
      {},
      {
        runId: "run-1",
        questionId: "kimi-question-run-1-7",
        action: "skip",
      },
    );

    expect(responses).toEqual([
      {
        runId: "run-1",
        questionId: "kimi-question-run-1-7",
        action: "skip",
      },
    ]);
  });

  it("chat:question-response rejects malformed responses", async () => {
    const handlers = new Map<string, Function>();
    const responses: unknown[] = [];

    registerChatIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          removeRuntimeSession: async () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: async () => {},
          getStatus: async () => null,
        },
      },
    );

    const handler = handlers.get("chat:question-response")!;
    const malformed: unknown[] = [
      null,
      "skip",
      { runId: "run-1", action: "skip" },
      { questionId: "q-1", action: "skip" },
      { runId: " ", questionId: "q-1", action: "skip" },
      { runId: "run-1", questionId: "q-1", action: "answer" },
      { runId: "run-1", questionId: "q-1", action: "submit" },
      { runId: "run-1", questionId: "q-1", action: "submit", answers: [] },
      { runId: "run-1", questionId: "q-1", action: "submit", answers: "opt_ts" },
      {
        runId: "run-1",
        questionId: "q-1",
        action: "submit",
        answers: [{ questionIndex: "0", optionIds: ["opt_ts"] }],
      },
      {
        runId: "run-1",
        questionId: "q-1",
        action: "submit",
        answers: [{ questionIndex: -1, optionIds: ["opt_ts"] }],
      },
      {
        runId: "run-1",
        questionId: "q-1",
        action: "submit",
        answers: [{ questionIndex: 0, optionIds: [] }],
      },
      {
        runId: "run-1",
        questionId: "q-1",
        action: "submit",
        answers: [{ questionIndex: 0, optionIds: [""] }],
      },
      {
        runId: "run-1",
        questionId: "q-1",
        action: "submit",
        answers: [{ questionIndex: 0, optionIds: ["other"], customText: 7 }],
      },
      {
        runId: "run-1",
        questionId: "q-1",
        action: "submit",
        answers: [{ questionIndex: 0, optionIds: ["other"], customText: "  " }],
      },
    ];

    for (const value of malformed) {
      let thrown: unknown = null;
      try {
        await handler({}, value);
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof Error).toBe(true);
      expect((thrown as Error).message).toBe("Invalid question response.");
    }
    expect(responses).toEqual([]);
  });
});
