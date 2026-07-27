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
          respondToQuestion: () => {},
          shutdown: () => {},
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
          respondToQuestion: () => {},
          shutdown: () => {},
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
    const workspace = {
      version: 1,
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    };

    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: () => {},
          stop: () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: () => {},
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
        beforeWorkspace: workspace,
        afterWorkspace: workspace,
        threadData: { threadIds: ["thread-1"], attachmentStorageKeys: [] },
      },
    );

    expect(deleted).toEqual([
      {
        beforeAppState: appState,
        afterAppState: appState,
        beforeWorkspace: workspace,
        afterWorkspace: workspace,
        threadData: { threadIds: ["thread-1"], attachmentStorageKeys: [] },
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
          deleteThreadData: async (request) => {
            deleted.push(request);
          },
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: () => {},
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
          respondToQuestion: () => {},
          shutdown: () => {},
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

  it("forwards Association Draft identity and Project Working Directory with its reserved Run ID", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const started: { runId: string; request: ChatTurnRequest }[] = [];
    registerChatIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        sessionManager: {
          start: (runId, request) => started.push({ runId, request }),
          stop: () => {},
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: () => {},
          getStatus: async () => null,
        },
      },
    );
    const request = makeRequest({
      runId: "run-draft-1",
      workspace: {
        kind: "project",
        workspaceId: "workspace-1",
        projectId: "project-1",
        projectPath: "/code/carrent",
      },
      threadId: "thread-1",
      draftRef: {
        draftId: "draft-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "Create threads from drafts",
      },
    });

    const result = await handlers.get("chat:send")?.({}, request);

    expect(result).toEqual({ runId: "run-draft-1" });
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: () => {},
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: () => {},
          shutdown: () => {},
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
            respondToQuestion: () => {},
            shutdown: () => {},
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
          respondToQuestion: () => {},
          shutdown: () => {},
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
          respondToQuestion: () => {},
          shutdown: () => {},
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
          respondToQuestion: () => {},
          shutdown: () => {},
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
          respondToQuestion: () => {},
          shutdown: () => {},
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
          respondToQuestion: () => {},
          shutdown: () => {},
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: () => {},
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: () => {},
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: () => {},
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
          deleteThreadData: async () => {},
          respondToPermission: () => {},
          respondToQuestion: (response) => responses.push(response),
          shutdown: () => {},
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
