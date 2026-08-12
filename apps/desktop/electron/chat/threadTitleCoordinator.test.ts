import { describe, expect, it } from "bun:test";

import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  APP_STATE_SNAPSHOT_VERSION,
  DEFAULT_APP_STATE_SETTINGS,
  type AppStateSettings,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { createAppStateAuthority } from "../workspace/appStateAuthority";
import { appStateCommandReducers } from "../workspace/appStateCommands";
import { createAppStateStoreStub } from "../workspace/appStateStore.testUtils";
import type { KimiAcpTransport } from "./kimiAcpChat";
import {
  createThreadTitleCoordinator as createProductionThreadTitleCoordinator,
  registerAcceptedThreadTitlePromotion,
} from "./threadTitleCoordinator";

type JsonObject = Record<string, unknown>;
type ThreadTitleCoordinatorOptions = Parameters<typeof createProductionThreadTitleCoordinator>[0];

function createThreadTitleCoordinator(
  options: Omit<ThreadTitleCoordinatorOptions, "resolveDefaultModelId"> &
    Partial<Pick<ThreadTitleCoordinatorOptions, "resolveDefaultModelId">>,
) {
  const coordinator = createProductionThreadTitleCoordinator({
    resolveDefaultModelId: async () => "kimi-default-concrete",
    ...options,
  });
  return {
    ...coordinator,
    // Most cases exercise a Run that follows a committed Draft promotion, which
    // the Main Process records before the Run is accepted. This helper performs
    // both steps so each test states only the title source it cares about.
    // Provenance itself is covered separately through the raw coordinator.
    enqueue(input: { threadId: string; runId: string; source: string }) {
      coordinator.registerPromotion(input);
      return coordinator.enqueue({ threadId: input.threadId, runId: input.runId });
    },
  };
}

function makeSnapshot(): AppStateSnapshot {
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [{ id: "workspace-1", name: "Workspace", order: 0 }],
    projects: [{ id: "project-1", name: "Project", workingDirectory: "/project" }],
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
        title: "Implement isolated titles",
        createdAt: "2026-08-11T00:00:00.000Z",
        lastActivityAt: "2026-08-11T00:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadDrafts: [],
    threadMessages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "Implement isolated titles",
        createdAt: "2026-08-11T00:00:00.000Z",
        attachments: [],
      },
      {
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "",
        createdAt: "2026-08-11T00:00:00.000Z",
        attachments: [],
        runStatus: "running",
        runEventCount: 0,
      },
    ],
    threadRuns: [
      {
        id: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        assistantMessageId: "assistant-1",
        startedAt: "2026-08-11T00:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadPromotionIntents: [],
    lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
    activeWorkspaceId: "workspace-1",
  };
}

function makeSnapshotWithJobs(count: number): AppStateSnapshot {
  const snapshot = makeSnapshot();
  const thread = snapshot.threads![0]!;
  const run = snapshot.threadRuns![0]!;
  return {
    ...snapshot,
    threads: Array.from({ length: count }, (_, index) => ({
      ...thread,
      id: `thread-${index + 1}`,
      title: `Fallback title ${index + 1}`,
    })),
    threadRuns: Array.from({ length: count }, (_, index) => ({
      ...run,
      id: `run-${index + 1}`,
      threadId: `thread-${index + 1}`,
    })),
  };
}

function makeSettings(overrides: Partial<AppStateSettings> = {}): AppStateSettings {
  return { ...DEFAULT_APP_STATE_SETTINGS, ...overrides };
}

class FakeTitleTransport implements KimiAcpTransport {
  readonly sent: JsonObject[] = [];
  closeCount = 0;
  private messageListener: (message: JsonObject) => void = () => {};
  private errorListener: (error: Error) => void = () => {};
  private closeListener: Parameters<KimiAcpTransport["onClose"]>[0] = () => {};
  private hangingRequest: JsonObject | null = null;

  constructor(
    private readonly outputChunks = ['{"title":"Isolated ', 'Thread title generation."}'],
    private readonly behavior: {
      configOptions?: unknown[];
      hangOn?: string;
      errorOn?: string;
      agentRequests?: JsonObject[];
    } = {},
  ) {}

  send(message: JsonObject) {
    this.sent.push(message);
    const method = message.method;
    if (method === this.behavior.hangOn) {
      this.hangingRequest = message;
      return;
    }
    if (method === this.behavior.errorOn) {
      this.errorListener(new Error("ACP unavailable"));
      return;
    }
    if (method === "initialize") {
      this.reply(message, { protocolVersion: 1 });
      return;
    }
    if (method === "session/new") {
      this.reply(message, {
        sessionId: "title-session-1",
        configOptions: this.behavior.configOptions ?? [
          {
            id: "model",
            category: "model",
            currentValue: "kimi-default-concrete",
            options: [{ value: "kimi-default-concrete", name: "Kimi Default" }],
          },
        ],
      });
      return;
    }
    if (method === "session/set_config_option") {
      this.reply(message, {});
      return;
    }
    if (method === "session/prompt") {
      this.completePrompt(message);
    }
  }

  close() {
    this.closeCount += 1;
  }

  onMessage(listener: (message: JsonObject) => void) {
    this.messageListener = listener;
  }

  onError(listener: (error: Error) => void) {
    this.errorListener = listener;
  }

  onClose(listener: Parameters<KimiAcpTransport["onClose"]>[0]) {
    this.closeListener = listener;
  }

  fail(error = new Error("ACP unavailable")) {
    this.errorListener(error);
  }

  complete() {
    if (!this.hangingRequest) throw new Error("No hanging ACP request.");
    const request = this.hangingRequest;
    this.hangingRequest = null;
    this.completePrompt(request);
  }

  private reply(request: JsonObject, result: unknown) {
    this.messageListener({ jsonrpc: "2.0", id: request.id, result });
  }

  private completePrompt(request: JsonObject) {
    for (const agentRequest of this.behavior.agentRequests ?? []) {
      this.messageListener(agentRequest);
    }
    this.messageListener({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "title-session-1",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "ignore this thought" },
        },
      },
    });
    for (const text of this.outputChunks) {
      this.messageListener({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "title-session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        },
      });
    }
    this.reply(request, { stopReason: "end_turn" });
  }
}

async function commandsForOutput(output: string) {
  const commands: AppStateCommand[] = [];
  const coordinator = createThreadTitleCoordinator({
    getSnapshot: makeSnapshot,
    submitCommand: async (command) => {
      commands.push(command);
      return { status: "accepted", revision: 1 };
    },
    transportFactory: () => new FakeTitleTransport([output]),
    createWorkingDirectory: async () => "/private/carrent-title-output-test",
    removeWorkingDirectory: async () => {},
  });
  coordinator.enqueue({
    threadId: "thread-1",
    runId: "run-1",
    source: "Implement isolated titles",
  });
  await coordinator.waitForIdle();
  return commands;
}

async function waitForCondition(condition: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  expect(condition()).toBe(true);
}

describe("Draft promotion provenance", () => {
  function createProvenanceCoordinator(getSnapshot: () => AppStateSnapshot) {
    const spawnedSources: string[] = [];
    const coordinator = createProductionThreadTitleCoordinator({
      getSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: async () => "kimi-default-concrete",
      transportFactory: () => {
        const transport = new FakeTitleTransport(['{"title":"Isolated title work"}']);
        spawnedSources.push("spawned");
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-provenance",
      removeWorkingDirectory: async () => {},
    });
    return { coordinator, spawnedSources };
  }

  it("skips a Run with no committed Draft promotion", async () => {
    const { coordinator, spawnedSources } = createProvenanceCoordinator(makeSnapshot);

    // The snapshot has exactly one Run on an eligible Thread, which is all the
    // Renderer could ever observe. Without a promotion the Main Process
    // recorded, generation must not start.
    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(false);
    await coordinator.waitForIdle();

    expect(spawnedSources).toEqual([]);
  });

  it("accepts a Run whose Draft promotion this process committed", async () => {
    const { coordinator, spawnedSources } = createProvenanceCoordinator(makeSnapshot);

    coordinator.registerPromotion({
      threadId: "thread-1",
      runId: "run-1",
      source: "Implement isolated titles",
    });
    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(true);
    await coordinator.waitForIdle();

    expect(spawnedSources).toEqual(["spawned"]);
  });

  it("records an accepted promotion through the App State authority before accepting its Run", async () => {
    const initialSnapshot: AppStateSnapshot = {
      ...makeSnapshot(),
      threads: [],
      threadMessages: [],
      threadRuns: [],
      threadDrafts: [
        {
          id: "draft-1",
          threadId: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "Implement isolated titles",
          attachedSkillNames: [],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
    };
    let coordinator: ReturnType<typeof createProductionThreadTitleCoordinator> | null = null;
    const authority = createAppStateAuthority({
      store: createAppStateStoreStub(),
      initialResult: { status: "ready", snapshot: initialSnapshot },
      reducers: appStateCommandReducers,
      publish: () => {},
      onCommandAccepted: (command, data) =>
        registerAcceptedThreadTitlePromotion(coordinator, command, data),
      onPersisted: (snapshot) => coordinator?.reconcile(snapshot),
    });
    const spawnedSources: string[] = [];
    coordinator = createProductionThreadTitleCoordinator({
      getSnapshot: () => authority.getState().snapshot,
      submitCommand: (command) => authority.submit(0, command),
      resolveDefaultModelId: async () => "kimi-default-concrete",
      transportFactory: () => {
        spawnedSources.push("spawned");
        return new FakeTitleTransport(['{"title":"Generated title"}']);
      },
      createWorkingDirectory: async () => "/private/carrent-title-authority-provenance",
      removeWorkingDirectory: async () => {},
    });

    const promotion = await authority.submit(1, {
      commandId: "promote-draft-1",
      type: "thread-draft:promote",
      payload: {
        draftId: "draft-1",
        threadId: "thread-1",
        titleSource: "Implement isolated titles",
        thread: {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          createdAt: "2026-08-11T00:00:00.000Z",
          lastActivityAt: "2026-08-11T00:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
        message: {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Implement isolated titles",
          createdAt: "2026-08-11T00:00:00.000Z",
          attachments: [],
        },
        assistantMessage: {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          content: "",
          createdAt: "2026-08-11T00:00:00.000Z",
          attachments: [],
          runStatus: "running",
          runEventCount: 0,
        },
        run: {
          id: "run-1",
          threadId: "thread-1",
          messageId: "message-1",
          assistantMessageId: "assistant-1",
          startedAt: "2026-08-11T00:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      },
    });

    expect(promotion).toMatchObject({ status: "accepted", data: { created: true } });
    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(true);
    await coordinator.waitForIdle();
    expect(spawnedSources).toEqual(["spawned"]);
  });

  it("consumes a promotion once, so a later Run on the Thread is skipped", async () => {
    const { coordinator } = createProvenanceCoordinator(makeSnapshot);

    coordinator.registerPromotion({
      threadId: "thread-1",
      runId: "run-1",
      source: "Implement isolated titles",
    });
    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(true);
    await coordinator.waitForIdle();
    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(false);
    await coordinator.waitForIdle();
  });

  it("rejects a promotion whose Run id does not match the accepted Run", async () => {
    const { coordinator, spawnedSources } = createProvenanceCoordinator(makeSnapshot);

    coordinator.registerPromotion({
      threadId: "thread-1",
      runId: "run-1",
      source: "Implement isolated titles",
    });
    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-2" })).toBe(false);
    await coordinator.waitForIdle();

    expect(spawnedSources).toEqual([]);
  });

  it("drops a rolled-back promotion before its Run is accepted", async () => {
    let snapshot = makeSnapshot();
    const { coordinator, spawnedSources } = createProvenanceCoordinator(() => snapshot);

    coordinator.registerPromotion({
      threadId: "thread-1",
      runId: "run-1",
      source: "Implement isolated titles",
    });
    // A synchronous first-Run startup failure rolls the promotion back, so the
    // Thread is gone from the next authoritative snapshot.
    snapshot = { ...snapshot, threads: [], threadRuns: [] };
    coordinator.reconcile(snapshot);

    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(false);
    await coordinator.waitForIdle();

    expect(spawnedSources).toEqual([]);
  });

  it("ignores a promotion with a blank title source", async () => {
    const { coordinator, spawnedSources } = createProvenanceCoordinator(makeSnapshot);

    coordinator.registerPromotion({ threadId: "thread-1", runId: "run-1", source: "   \n\t " });
    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(false);
    await coordinator.waitForIdle();

    expect(spawnedSources).toEqual([]);
  });

  it("discards pending promotions on shutdown", async () => {
    const { coordinator, spawnedSources } = createProvenanceCoordinator(makeSnapshot);

    coordinator.registerPromotion({
      threadId: "thread-1",
      runId: "run-1",
      source: "Implement isolated titles",
    });
    await coordinator.shutdown();

    expect(coordinator.enqueue({ threadId: "thread-1", runId: "run-1" })).toBe(false);
    expect(spawnedSources).toEqual([]);
  });
});

describe("createThreadTitleCoordinator", () => {
  it("runs at most two jobs and starts waiting jobs in FIFO order", async () => {
    const transports: Array<{ cwd: string; transport: FakeTitleTransport }> = [];
    let workingDirectoryCount = 0;
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => makeSnapshotWithJobs(4),
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      transportFactory: ({ cwd }) => {
        const transport = new FakeTitleTransport(undefined, { hangOn: "session/prompt" });
        transports.push({ cwd, transport });
        return transport;
      },
      createWorkingDirectory: async () => `/private/carrent-title-queue-${++workingDirectoryCount}`,
      removeWorkingDirectory: async () => {},
    });

    for (let index = 1; index <= 4; index += 1) {
      expect(
        coordinator.enqueue({
          threadId: `thread-${index}`,
          runId: `run-${index}`,
          source: `Visible request ${index}`,
        }),
      ).toBe(true);
    }
    await waitForCondition(
      () =>
        transports.length === 2 &&
        transports.every(({ transport }) =>
          transport.sent.some((message) => message.method === "session/prompt"),
        ),
    );

    expect(transports.map(({ cwd }) => cwd)).toEqual([
      "/private/carrent-title-queue-1",
      "/private/carrent-title-queue-2",
    ]);

    transports[0]!.transport.fail();
    await waitForCondition(() => transports.length === 3);
    expect(transports.map(({ cwd }) => cwd)).toEqual([
      "/private/carrent-title-queue-1",
      "/private/carrent-title-queue-2",
      "/private/carrent-title-queue-3",
    ]);

    transports[1]!.transport.fail();
    await waitForCondition(() => transports.length === 4);
    expect(transports.map(({ cwd }) => cwd)).toEqual([
      "/private/carrent-title-queue-1",
      "/private/carrent-title-queue-2",
      "/private/carrent-title-queue-3",
      "/private/carrent-title-queue-4",
    ]);

    await coordinator.shutdown();
  });

  it("keeps eight waiting jobs and skips new work when the queue is full", async () => {
    const transports: FakeTitleTransport[] = [];
    const commands: AppStateCommand[] = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => makeSnapshotWithJobs(11),
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: () => {
        const transport = new FakeTitleTransport(undefined, { hangOn: "session/prompt" });
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-overload",
      removeWorkingDirectory: async () => {},
    });

    for (let index = 1; index <= 10; index += 1) {
      expect(
        coordinator.enqueue({
          threadId: `thread-${index}`,
          runId: `run-${index}`,
          source: `Visible request ${index}`,
        }),
      ).toBe(true);
    }
    expect(
      coordinator.enqueue({
        threadId: "thread-11",
        runId: "run-11",
        source: "Visible request 11",
      }),
    ).toBe(false);

    await waitForCondition(
      () =>
        transports.length === 2 &&
        transports.every((transport) =>
          transport.sent.some((message) => message.method === "session/prompt"),
        ),
    );
    expect(commands).toEqual([]);

    await coordinator.shutdown();
    expect(transports).toHaveLength(2);
    expect(transports.every((transport) => transport.closeCount === 1)).toBe(true);
  });

  it("starts the execution timeout only after a waiting job gets a slot", async () => {
    let now = 1_000;
    const timeoutStarts: number[] = [];
    const transports: FakeTitleTransport[] = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => makeSnapshotWithJobs(3),
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      transportFactory: () => {
        const transport = new FakeTitleTransport(
          undefined,
          transports.length < 2 ? { hangOn: "session/prompt" } : {},
        );
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-timeout-queue",
      removeWorkingDirectory: async () => {},
      now: () => now,
      setTimeout: ((handler: TimerHandler) => {
        void handler;
        timeoutStarts.push(now);
        return timeoutStarts.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof globalThis.setTimeout,
      clearTimeout: (() => {}) as typeof globalThis.clearTimeout,
    });

    for (let index = 1; index <= 3; index += 1) {
      coordinator.enqueue({
        threadId: `thread-${index}`,
        runId: `run-${index}`,
        source: `Visible request ${index}`,
      });
    }
    await waitForCondition(
      () =>
        transports.length === 2 &&
        transports.every((transport) =>
          transport.sent.some((message) => message.method === "session/prompt"),
        ),
    );
    expect(timeoutStarts).toEqual([1_000, 1_000]);

    now = 61_000;
    transports[0]!.fail();
    transports[1]!.fail();
    await coordinator.waitForIdle();

    expect(timeoutStarts).toEqual([1_000, 1_000, 61_000]);
  });

  for (const outcome of [
    "success",
    "validation-failure",
    "acp-failure",
    "timeout",
    "cancellation",
    "write-rejection",
  ] as const) {
    it(`releases one slot after ${outcome}`, async () => {
      let snapshot = makeSnapshotWithJobs(3);
      const transports: FakeTitleTransport[] = [];
      const timeoutHandlers: TimerHandler[] = [];
      const coordinator = createThreadTitleCoordinator({
        getSnapshot: () => snapshot,
        submitCommand: async (command) =>
          outcome === "write-rejection" &&
          (command.payload as { threadId?: string } | undefined)?.threadId === "thread-1"
            ? { status: "rejected", reason: "invalid", revision: 1 }
            : { status: "accepted", revision: 1 },
        transportFactory: () => {
          const transport = new FakeTitleTransport(
            outcome === "validation-failure" && transports.length === 0 ? ["{}"] : undefined,
            transports.length < 2 ? { hangOn: "session/prompt" } : {},
          );
          transports.push(transport);
          return transport;
        },
        createWorkingDirectory: async () => "/private/carrent-title-slot-release",
        removeWorkingDirectory: async () => {},
        setTimeout: ((handler: TimerHandler) => {
          timeoutHandlers.push(handler);
          return timeoutHandlers.length as unknown as ReturnType<typeof setTimeout>;
        }) as unknown as typeof globalThis.setTimeout,
        clearTimeout: (() => {}) as typeof globalThis.clearTimeout,
      });

      for (let index = 1; index <= 3; index += 1) {
        coordinator.enqueue({
          threadId: `thread-${index}`,
          runId: `run-${index}`,
          source: `Visible request ${index}`,
        });
      }
      await waitForCondition(
        () =>
          transports.length === 2 &&
          transports.every((transport) =>
            transport.sent.some((message) => message.method === "session/prompt"),
          ),
      );

      if (
        outcome === "success" ||
        outcome === "validation-failure" ||
        outcome === "write-rejection"
      ) {
        transports[0]!.complete();
      } else if (outcome === "acp-failure") {
        transports[0]!.fail();
      } else if (outcome === "timeout") {
        (timeoutHandlers[0] as () => void)();
      } else {
        snapshot = {
          ...snapshot,
          threads: snapshot.threads?.map((thread) =>
            thread.id === "thread-1" ? { ...thread, archived: true } : thread,
          ),
        };
        coordinator.reconcile(snapshot);
      }

      await waitForCondition(() => transports.length === 3);
      await waitForCondition(() => transports[0]!.closeCount === 1);
      expect(transports[0]!.closeCount).toBe(1);

      await coordinator.shutdown();
      expect(transports.every((transport) => transport.closeCount === 1)).toBe(true);
    });
  }

  it("rechecks authoritative Thread eligibility before starting a waiting job", async () => {
    const invalidateWaitingThread = [
      (snapshot: AppStateSnapshot) => ({
        ...snapshot,
        threads: snapshot.threads?.filter((thread) => thread.id !== "thread-3"),
      }),
      (snapshot: AppStateSnapshot) => ({
        ...snapshot,
        threads: snapshot.threads?.map((thread) =>
          thread.id === "thread-3" ? { ...thread, archived: true } : thread,
        ),
      }),
      (snapshot: AppStateSnapshot) => ({
        ...snapshot,
        threads: snapshot.threads?.map((thread) =>
          thread.id === "thread-3" ? { ...thread, customTitle: true } : thread,
        ),
      }),
      (snapshot: AppStateSnapshot) => ({
        ...snapshot,
        threads: snapshot.threads?.map((thread) =>
          thread.id === "thread-3" ? { ...thread, title: "Changed fallback" } : thread,
        ),
      }),
    ];

    for (const invalidate of invalidateWaitingThread) {
      let snapshot = makeSnapshotWithJobs(3);
      const transports: FakeTitleTransport[] = [];
      const coordinator = createThreadTitleCoordinator({
        getSnapshot: () => snapshot,
        submitCommand: async () => ({ status: "accepted", revision: 1 }),
        transportFactory: () => {
          const transport = new FakeTitleTransport(
            undefined,
            transports.length < 2 ? { hangOn: "session/prompt" } : {},
          );
          transports.push(transport);
          return transport;
        },
        createWorkingDirectory: async () => "/private/carrent-title-recheck",
        removeWorkingDirectory: async () => {},
      });

      for (let index = 1; index <= 3; index += 1) {
        coordinator.enqueue({
          threadId: `thread-${index}`,
          runId: `run-${index}`,
          source: `Visible request ${index}`,
        });
      }
      await waitForCondition(
        () =>
          transports.length === 2 &&
          transports.every((transport) =>
            transport.sent.some((message) => message.method === "session/prompt"),
          ),
      );

      snapshot = invalidate(snapshot);
      transports[0]!.fail();
      transports[1]!.fail();
      await coordinator.waitForIdle();

      expect(transports).toHaveLength(2);
    }
  });

  it("cancels running jobs and removes waiting jobs after authoritative lifecycle changes", async () => {
    let snapshot = makeSnapshotWithJobs(4);
    const transports: FakeTitleTransport[] = [];
    const commands: AppStateCommand[] = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => snapshot,
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: () => {
        const transport = new FakeTitleTransport(
          undefined,
          transports.length < 2 ? { hangOn: "session/prompt" } : {},
        );
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-lifecycle",
      removeWorkingDirectory: async () => {},
    });

    for (let index = 1; index <= 4; index += 1) {
      coordinator.enqueue({
        threadId: `thread-${index}`,
        runId: `run-${index}`,
        source: `Visible request ${index}`,
      });
    }
    await waitForCondition(
      () =>
        transports.length === 2 &&
        transports.every((transport) =>
          transport.sent.some((message) => message.method === "session/prompt"),
        ),
    );

    snapshot = {
      ...snapshot,
      threads: snapshot.threads?.flatMap((thread) => {
        if (thread.id === "thread-1") return [{ ...thread, archived: true }];
        if (thread.id === "thread-2") {
          return [{ ...thread, title: "Manual title", customTitle: true }];
        }
        return thread.id === "thread-3" ? [] : [thread];
      }),
    };
    coordinator.reconcile(snapshot);
    await coordinator.waitForIdle();

    expect(transports).toHaveLength(3);
    expect(transports.slice(0, 2).every((transport) => transport.closeCount === 1)).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.payload).toMatchObject({ threadId: "thread-4" });
  });

  it("runs one isolated Kimi ACP title request and commits the validated title", async () => {
    const published: Array<{ subscriberId: number; snapshot: AppStateSnapshot }> = [];
    let coordinator: ReturnType<typeof createThreadTitleCoordinator> | null = null;
    const authority = createAppStateAuthority({
      store: createAppStateStoreStub(),
      initialResult: { status: "ready", snapshot: makeSnapshot() },
      reducers: appStateCommandReducers,
      publish: (subscriberId, state) => published.push({ subscriberId, snapshot: state.snapshot }),
      onPersisted: (snapshot) => coordinator?.reconcile(snapshot),
    });
    authority.subscribe(11);
    authority.subscribe(22);

    const transports: Array<{ cwd: string; transport: FakeTitleTransport }> = [];
    const removedDirectories: string[] = [];
    const commands: AppStateCommand[] = [];
    coordinator = createThreadTitleCoordinator({
      getSnapshot: () => authority.getState().snapshot,
      submitCommand: (command) => {
        commands.push(command);
        return authority.submit(0, command);
      },
      transportFactory: ({ cwd }) => {
        const transport = new FakeTitleTransport();
        transports.push({ cwd, transport });
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-job-1",
      removeWorkingDirectory: async (cwd) => {
        removedDirectories.push(cwd);
      },
    });

    expect(
      coordinator.enqueue({
        threadId: "thread-1",
        runId: "run-1",
        source: "Implement isolated titles",
      }),
    ).toBe(true);
    await coordinator.waitForIdle();

    expect(transports).toHaveLength(1);
    expect(transports[0]!.cwd).toBe("/private/carrent-title-job-1");
    const sent = transports[0]!.transport.sent;
    expect(sent.flatMap((message) => (message.method ? [message.method] : []))).toEqual([
      "initialize",
      "session/new",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect(sent.find((message) => message.method === "initialize")).toBeDefined();
    expect(sent.find((message) => message.method === "session/new")).toMatchObject({
      method: "session/new",
      params: {
        cwd: "/private/carrent-title-job-1",
        mcpServers: [],
      },
    });
    expect(sent.find((message) => message.method === "session/set_config_option")).toMatchObject({
      method: "session/set_config_option",
      params: {
        sessionId: "title-session-1",
        configId: "model",
        value: "kimi-default-concrete",
      },
    });
    expect(sent.find((message) => message.method === "session/prompt")).toBeDefined();
    const promptText =
      (
        sent.find((message) => message.method === "session/prompt")?.params as {
          prompt?: Array<{ text?: string }>;
        }
      )?.prompt?.[0]?.text ?? "";
    expect(promptText).toContain("exactly one string property");
    expect(promptText).toContain("For English titles, use 1-8 words");
    expect(promptText).toContain("source may have been truncated");
    expect(transports[0]!.transport.sent.some((message) => message.method === "session/load")).toBe(
      false,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "thread:set-automatic-title",
      payload: {
        threadId: "thread-1",
        expectedTitle: "Implement isolated titles",
        title: "Isolated Thread title generation",
      },
    });
    expect(authority.getState().snapshot.threads?.[0]?.title).toBe(
      "Isolated Thread title generation",
    );
    expect(published.slice(-2).map((entry) => entry.subscriberId)).toEqual([11, 22]);
    expect(transports[0]!.transport.closeCount).toBe(1);
    expect(removedDirectories).toEqual(["/private/carrent-title-job-1"]);
  });

  it("accepts only a complete JSON document or one outer json fence", async () => {
    const pure = await commandsForOutput('{"title":"Improve settings navigation."}');
    expect(pure).toHaveLength(1);
    expect(pure[0]?.payload).toMatchObject({ title: "Improve settings navigation" });

    const fenced = await commandsForOutput(
      '```json\n{"title":"Improve settings navigation!"}\n```',
    );
    expect(fenced).toHaveLength(1);
    expect(fenced[0]?.payload).toMatchObject({ title: "Improve settings navigation" });

    for (const invalid of [
      'Here is the title: {"title":"Improve settings navigation"}',
      '{"title":"Improve settings navigation"}\nThanks!',
      '```\n{"title":"Improve settings navigation"}\n```',
      '```json\n{"title":"Improve settings navigation"}\n```\nMore',
    ]) {
      expect(await commandsForOutput(invalid)).toHaveLength(0);
    }
  });

  it("rejects verbose output instead of accumulating it", async () => {
    // A valid payload is one small JSON object. Output past the collection
    // ceiling is discarded, so a verbose or runaway response cannot hold memory
    // for the rest of the timeout window and is rejected as invalid.
    const runaway = `{"title":"${"very ".repeat(4_000)}long"}`;
    expect(runaway.length).toBeGreaterThan(8_192);
    expect(await commandsForOutput(runaway)).toHaveLength(0);

    // A valid title arriving after the ceiling is exceeded is not rescued.
    const commands = await commandsForOutput(
      `${"noise ".repeat(2_000)}{"title":"Improve settings navigation"}`,
    );
    expect(commands).toHaveLength(0);
  });

  it("rejects invalid title object shapes and values", async () => {
    for (const invalid of [
      "{}",
      '{"title":"Improve settings navigation","extra":true}',
      '{"title":42}',
      '{"title":""}',
      '{"title":"   "}',
      '{"title":"Improve\\nsettings navigation"}',
      '{"title":"修复桌面\\u2028标题生成"}',
      '{"title":"修复桌面\\u2029标题生成"}',
      "null",
      "[]",
    ]) {
      expect(await commandsForOutput(invalid)).toHaveLength(0);
    }
  });

  it("normalizes paired quotes and terminal punctuation but preserves internal punctuation", async () => {
    const commands = await commandsForOutput('{"title":"“Improve navigation, preserve context:”"}');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.payload).toMatchObject({
      title: "Improve navigation, preserve context",
    });

    const punctuationOutsideQuotes = await commandsForOutput(
      '{"title":"“Improve navigation context”."}',
    );
    expect(punctuationOutsideQuotes[0]?.payload).toMatchObject({
      title: "Improve navigation context",
    });
  });

  it("applies Han grapheme minimum length rules without truncating", async () => {
    expect(await commandsForOutput('{"title":"修复标题"}')).toHaveLength(0);

    const accepted = await commandsForOutput('{"title":"修复桌面标题生成"}');
    expect(accepted[0]?.payload).toMatchObject({ title: "修复桌面标题生成" });

    const longTitle = "这是一个超过十八个字的自动生成会话标题用于测试截断";
    const generated = await commandsForOutput(JSON.stringify({ title: longTitle }));
    expect(generated[0]?.payload).toMatchObject({ title: longTitle });
  });

  it("does not enforce English word counts after generation", async () => {
    const short = await commandsForOutput('{"title":"Hi"}');
    expect(short[0]?.payload).toMatchObject({ title: "Hi" });

    const longTitle = "Improve the desktop automatic thread title generation flow now please";
    const long = await commandsForOutput(JSON.stringify({ title: longTitle }));
    expect(long[0]?.payload).toMatchObject({ title: longTitle });
  });

  it("bounds the visible source to 8000 graphemes before prompting", async () => {
    const transport = new FakeTitleTransport();
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      transportFactory: () => transport,
      createWorkingDirectory: async () => "/private/carrent-title-source-test",
      removeWorkingDirectory: async () => {},
    });
    const source = `${"a".repeat(7_999)}👋🏽ignored`;

    coordinator.enqueue({ threadId: "thread-1", runId: "run-1", source });
    await coordinator.waitForIdle();

    const promptRequest = transport.sent.find((message) => message.method === "session/prompt");
    const prompt =
      (promptRequest?.params as { prompt?: Array<{ text?: string }> } | undefined)?.prompt?.[0]
        ?.text ?? "";
    const encodedSource = prompt.split("Thread title source: ")[1];
    expect(encodedSource).toBeDefined();
    const promptedSource = JSON.parse(encodedSource!) as string;
    expect([
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(promptedSource),
    ]).toHaveLength(8_000);
    expect(promptedSource.endsWith("👋🏽")).toBe(true);
    expect(promptedSource).not.toContain("ignored");
  });

  it("rejects every ACP tool and approval request", async () => {
    const transport = new FakeTitleTransport(undefined, {
      agentRequests: [
        {
          jsonrpc: "2.0",
          id: "read-1",
          method: "fs/read_text_file",
          params: { path: "/project/secret.txt" },
        },
        {
          jsonrpc: "2.0",
          id: "permission-1",
          method: "session/request_permission",
          params: { sessionId: "title-session-1", options: [] },
        },
      ],
    });
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      transportFactory: () => transport,
      createWorkingDirectory: async () => "/private/carrent-title-tool-test",
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.waitForIdle();

    for (const id of ["read-1", "permission-1"]) {
      expect(transport.sent.find((message) => message.id === id)).toMatchObject({
        jsonrpc: "2.0",
        id,
        error: { code: -32601 },
      });
    }
  });

  it("leaves the fallback unchanged when the Kimi default model is unavailable", async () => {
    const transport = new FakeTitleTransport(undefined, { configOptions: [] });
    const commands: AppStateCommand[] = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: () => transport,
      createWorkingDirectory: async () => "/private/carrent-title-model-test",
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.waitForIdle();

    expect(commands).toEqual([]);
    expect(transport.sent.some((message) => message.method === "session/prompt")).toBe(false);
    expect(transport.closeCount).toBe(1);
  });

  it("does not retry after an ACP failure and still closes the transport", async () => {
    const transports: FakeTitleTransport[] = [];
    const commands: AppStateCommand[] = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: () => {
        const transport = new FakeTitleTransport(undefined, { errorOn: "initialize" });
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-acp-failure-test",
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.waitForIdle();

    expect(transports).toHaveLength(1);
    expect(transports[0]?.closeCount).toBe(1);
    expect(commands).toEqual([]);
  });

  it("uses one 30-second timeout from process spawn and cleans up a hung request", async () => {
    const transport = new FakeTitleTransport(undefined, { hangOn: "session/prompt" });
    let timeoutHandler: (() => void) | null = null;
    let timeoutMs: number | undefined;
    let spawned = false;
    const removedDirectories: string[] = [];
    const commands: AppStateCommand[] = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: () => {
        spawned = true;
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-timeout-test",
      removeWorkingDirectory: async (cwd) => {
        removedDirectories.push(cwd);
      },
      setTimeout: ((handler: TimerHandler, delay?: number) => {
        timeoutHandler = () => {
          if (typeof handler === "function") handler();
        };
        timeoutMs = delay;
        return 1;
      }) as typeof globalThis.setTimeout,
      clearTimeout: (() => {}) as typeof globalThis.clearTimeout,
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(spawned).toBe(true);
    expect(timeoutMs).toBe(30_000);
    expect(timeoutHandler).not.toBe(null);
    timeoutHandler!();
    await coordinator.waitForIdle();

    expect(commands).toEqual([]);
    expect(transport.closeCount).toBe(1);
    expect(removedDirectories).toEqual(["/private/carrent-title-timeout-test"]);
  });

  it("cancels a running title process during shutdown", async () => {
    const transport = new FakeTitleTransport(undefined, { hangOn: "session/prompt" });
    let timeoutHandler: (() => void) | null = null;
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      transportFactory: () => transport,
      createWorkingDirectory: async () => "/private/carrent-title-shutdown-test",
      removeWorkingDirectory: async () => {},
      setTimeout: ((handler: TimerHandler) => {
        timeoutHandler = () => {
          if (typeof handler === "function") handler();
        };
        return 1;
      }) as typeof globalThis.setTimeout,
      clearTimeout: (() => {}) as typeof globalThis.clearTimeout,
    });
    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    let shutdownSettled = false;
    const shutdown = coordinator.shutdown().then(() => {
      shutdownSettled = true;
    });
    for (let index = 0; index < 20 && !shutdownSettled; index += 1) await Promise.resolve();
    const settledBeforeTimeout = shutdownSettled;
    (timeoutHandler as (() => void) | null)?.();
    await shutdown;

    expect(settledBeforeTimeout).toBe(true);
    expect(transport.closeCount).toBe(1);
  });

  it("emits only bounded diagnostic metadata", async () => {
    const diagnostics: unknown[] = [];
    const source = "private source text";
    const rawOutput = "private raw output";
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      transportFactory: () => new FakeTitleTransport([rawOutput]),
      createWorkingDirectory: async () => "/private/secret/title-job",
      removeWorkingDirectory: async () => {},
      now: () => 42,
      log: (diagnostic) => diagnostics.push(diagnostic),
    });

    coordinator.enqueue({ threadId: "thread-1", runId: "run-1", source });
    await coordinator.waitForIdle();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      threadId: "thread-1",
      modelId: "kimi-default-concrete",
      stage: "validation",
      category: "invalid-output",
      elapsedMs: 0,
    });
    const serialized = JSON.stringify(diagnostics);
    for (const secret of [source, rawOutput, "title-job", "/private/secret"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("bounds runtime-provided model IDs in diagnostics", async () => {
    const diagnostics: unknown[] = [];
    const modelId = "m".repeat(1_000);
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: async () => modelId,
      transportFactory: () =>
        new FakeTitleTransport(["invalid"], {
          configOptions: [
            {
              id: "model",
              category: "model",
              currentValue: modelId,
              options: [{ value: modelId, name: "Long Model" }],
            },
          ],
        }),
      createWorkingDirectory: async () => "/private/carrent-title-log-bound-test",
      removeWorkingDirectory: async () => {},
      log: (diagnostic) => diagnostics.push(diagnostic),
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.waitForIdle();

    expect((diagnostics[0] as { modelId: string }).modelId.length).toBeLessThanOrEqual(256);
  });

  it("reports an authoritative write rejection without treating it as success", async () => {
    const diagnostics: Array<{ stage: string; category: string }> = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({
        status: "rejected",
        reason: "persistence-failed",
        revision: 0,
      }),
      transportFactory: () => new FakeTitleTransport(),
      createWorkingDirectory: async () => "/private/carrent-title-write-test",
      removeWorkingDirectory: async () => {},
      log: (diagnostic) => diagnostics.push(diagnostic),
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.waitForIdle();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ stage: "write", category: "persistence-failed" });
  });

  it("skips ineligible authoritative Thread states before spawning", async () => {
    const snapshots = [
      { ...makeSnapshot(), threads: [] },
      {
        ...makeSnapshot(),
        threads: makeSnapshot().threads?.map((thread) => ({ ...thread, archived: true })),
      },
      {
        ...makeSnapshot(),
        threads: makeSnapshot().threads?.map((thread) => ({ ...thread, customTitle: true })),
      },
      {
        ...makeSnapshot(),
        threadRuns: [
          ...makeSnapshot().threadRuns!,
          { ...makeSnapshot().threadRuns![0]!, id: "run-2" },
        ],
      },
    ];

    for (const snapshot of snapshots) {
      let spawnCount = 0;
      const coordinator = createThreadTitleCoordinator({
        getSnapshot: () => snapshot,
        submitCommand: async () => ({ status: "accepted", revision: 1 }),
        transportFactory: () => {
          spawnCount += 1;
          return new FakeTitleTransport();
        },
        createWorkingDirectory: async () => "/private/carrent-title-ineligible-test",
        removeWorkingDirectory: async () => {},
      });
      expect(
        coordinator.enqueue({
          threadId: "thread-1",
          runId: "run-1",
          source: "Visible first request",
        }),
      ).toBe(false);
      expect(spawnCount).toBe(0);
    }
  });

  it("configures a snapshotted concrete threadTitleModelId before prompting", async () => {
    const transports: FakeTitleTransport[] = [];
    const commands: AppStateCommand[] = [];
    const snapshot: AppStateSnapshot = {
      ...makeSnapshot(),
      settings: makeSettings({ threadTitleModelId: "kimi-k2.5" }),
    };
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => snapshot,
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: () => {
        const transport = new FakeTitleTransport(undefined, {
          configOptions: [
            {
              id: "model",
              category: "model",
              currentValue: "kimi-default-concrete",
              options: [
                { value: "kimi-default-concrete", name: "Kimi Default" },
                { value: "kimi-k2.5", name: "Kimi K2.5" },
              ],
            },
          ],
        });
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-configured-model",
      removeWorkingDirectory: async () => {},
    });

    expect(
      coordinator.enqueue({
        threadId: "thread-1",
        runId: "run-1",
        source: "Visible first request",
      }),
    ).toBe(true);
    await coordinator.waitForIdle();

    // The configured model — not the ACP default — is selected and configured.
    expect(transports[0]!.sent).toMatchObject([
      { method: "initialize" },
      { method: "session/new" },
      {
        method: "session/set_config_option",
        params: { configId: "model", value: "kimi-k2.5" },
      },
      { method: "session/prompt" },
    ]);
    // The title commit carries the generated title, not the model id.
    expect(commands[0]?.type).toBe("thread:set-automatic-title");
  });

  it("snapshots Kimi default independently for each accepted job", async () => {
    let resolutionCount = 0;
    const resolvedModels = ["kimi-default-a", "kimi-default-b", "kimi-default-c"];
    const transports: FakeTitleTransport[] = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => makeSnapshotWithJobs(3),
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: () => {
        const modelId = resolvedModels[resolutionCount];
        resolutionCount += 1;
        return Promise.resolve(modelId ?? null);
      },
      transportFactory: () => {
        const transport = new FakeTitleTransport(undefined, {
          ...(transports.length < 2 ? { hangOn: "session/prompt" } : {}),
          configOptions: [
            {
              id: "model",
              category: "model",
              currentValue: "kimi-default-b",
              options: [
                { value: "kimi-default-a", name: "Kimi Default A" },
                { value: "kimi-default-b", name: "Kimi Default B" },
                { value: "kimi-default-c", name: "Kimi Default C" },
              ],
            },
          ],
        });
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-default-snapshot",
      removeWorkingDirectory: async () => {},
    });

    for (let index = 1; index <= 3; index += 1) {
      coordinator.enqueue({
        threadId: `thread-${index}`,
        runId: `run-${index}`,
        source: `Visible request ${index}`,
      });
    }
    expect(resolutionCount).toBe(3);
    await waitForCondition(
      () =>
        transports.length === 2 &&
        transports.every((transport) =>
          transport.sent.some((message) => message.method === "session/prompt"),
        ),
    );

    expect(
      transports.map(
        (transport) =>
          (
            transport.sent.find((message) => message.method === "session/set_config_option")
              ?.params as { value?: string } | undefined
          )?.value,
      ),
    ).toEqual(["kimi-default-a", "kimi-default-b"]);

    transports[0]!.fail();
    transports[1]!.fail();
    await coordinator.waitForIdle();
    expect(
      transports.map(
        (transport) =>
          (
            transport.sent.find((message) => message.method === "session/set_config_option")
              ?.params as { value?: string } | undefined
          )?.value,
      ),
    ).toEqual(["kimi-default-a", "kimi-default-b", "kimi-default-c"]);
  });

  it("skips title ACP startup when Kimi default cannot be resolved at acceptance", async () => {
    let spawnCount = 0;
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: async () => null,
      transportFactory: () => {
        spawnCount += 1;
        return new FakeTitleTransport();
      },
      createWorkingDirectory: async () => "/private/carrent-title-no-default",
      removeWorkingDirectory: async () => {},
    });

    expect(
      coordinator.enqueue({
        threadId: "thread-1",
        runId: "run-1",
        source: "Visible first request",
      }),
    ).toBe(true);
    await coordinator.waitForIdle();

    expect(spawnCount).toBe(0);
  });

  it("cancels pending default-model resolution during shutdown", async () => {
    let resolverSignal: AbortSignal | null = null;
    let spawnCount = 0;
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: (signal) => {
        resolverSignal = signal;
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(null), { once: true });
        });
      },
      transportFactory: () => {
        spawnCount += 1;
        return new FakeTitleTransport();
      },
      createWorkingDirectory: async () => "/private/carrent-title-resolver-shutdown",
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.shutdown();

    expect((resolverSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(spawnCount).toBe(0);
  });

  it("cancels default-model resolution when its Thread is removed", async () => {
    let snapshot = makeSnapshot();
    let resolverSignal: AbortSignal | null = null;
    let spawnCount = 0;
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => snapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: (signal) =>
        new Promise((resolve) => {
          resolverSignal = signal;
          signal.addEventListener("abort", () => resolve(null), { once: true });
        }),
      transportFactory: () => {
        spawnCount += 1;
        return new FakeTitleTransport();
      },
      createWorkingDirectory: async () => "/private/carrent-title-removed-admission",
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    snapshot = { ...snapshot, threads: [] };
    coordinator.reconcile(snapshot);
    await coordinator.waitForIdle();

    expect((resolverSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(spawnCount).toBe(0);
  });

  it("starts a fresh default-model resolution while a cancelled lookup is closing", async () => {
    let snapshot = makeSnapshotWithJobs(2);
    const resolverSignals: AbortSignal[] = [];
    const resolveModels: Array<(modelId: string | null) => void> = [];
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => snapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: (signal) => {
        resolverSignals.push(signal);
        return new Promise((resolve) => resolveModels.push(resolve));
      },
      transportFactory: () => new FakeTitleTransport(),
      createWorkingDirectory: async () => "/private/carrent-title-resolver-restart",
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    snapshot = {
      ...snapshot,
      threads: snapshot.threads?.filter((thread) => thread.id !== "thread-1"),
    };
    coordinator.reconcile(snapshot);
    coordinator.enqueue({
      threadId: "thread-2",
      runId: "run-2",
      source: "Visible second request",
    });

    expect(resolverSignals).toHaveLength(2);
    expect(resolverSignals[0]?.aborted).toBe(true);
    expect(resolverSignals[1]?.aborted).toBe(false);
    resolveModels[1]!("kimi-default-concrete");
    resolveModels[0]!(null);
    await coordinator.waitForIdle();
  });

  it("releases a job when default-model resolution throws synchronously", async () => {
    let spawnCount = 0;
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: makeSnapshot,
      submitCommand: async () => ({ status: "accepted", revision: 1 }),
      resolveDefaultModelId: () => {
        throw new Error("model listing unavailable");
      },
      transportFactory: () => {
        spawnCount += 1;
        return new FakeTitleTransport();
      },
      createWorkingDirectory: async () => "/private/carrent-title-resolver-throw",
      removeWorkingDirectory: async () => {},
    });

    const input = {
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    };
    expect(coordinator.enqueue(input)).toBe(true);
    await coordinator.waitForIdle();

    expect(spawnCount).toBe(0);
    expect(coordinator.enqueue(input)).toBe(true);
    await coordinator.waitForIdle();
  });

  it("skips generation when a configured concrete model is no longer listed", async () => {
    const transports: FakeTitleTransport[] = [];
    const commands: AppStateCommand[] = [];
    const snapshot: AppStateSnapshot = {
      ...makeSnapshot(),
      settings: makeSettings({ threadTitleModelId: "kimi-removed-model" }),
    };
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => snapshot,
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: () => {
        const transport = new FakeTitleTransport(undefined, {
          configOptions: [
            {
              id: "model",
              category: "model",
              currentValue: "kimi-default-concrete",
              options: [{ value: "kimi-default-concrete", name: "Kimi Default" }],
            },
          ],
        });
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => "/private/carrent-title-removed-model",
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.waitForIdle();

    // No title write, no prompt, and never a fallback to the ACP default model.
    expect(commands).toEqual([]);
    expect(transports[0]!.sent.some((message) => message.method === "session/prompt")).toBe(false);
    expect(
      transports[0]!.sent.find((message) => message.method === "session/set_config_option"),
    ).toBeUndefined();
    expect(transports[0]!.closeCount).toBe(1);
  });

  it("does not alter an accepted job when the setting changes after enqueue", async () => {
    const transports: FakeTitleTransport[] = [];
    const commands: AppStateCommand[] = [];
    // The snapshot mutates after enqueue: the job must keep the model captured
    // at acceptance time rather than re-reading the live setting.
    let threadTitleModelId: string | undefined = "kimi-k2.5";
    const coordinator = createThreadTitleCoordinator({
      getSnapshot: () => ({
        ...makeSnapshot(),
        settings: makeSettings({ threadTitleModelId }),
      }),
      submitCommand: async (command) => {
        commands.push(command);
        return { status: "accepted", revision: 1 };
      },
      transportFactory: ({ cwd }) => {
        void cwd;
        const transport = new FakeTitleTransport(undefined, {
          configOptions: [
            {
              id: "model",
              category: "model",
              currentValue: "kimi-default-concrete",
              options: [
                { value: "kimi-default-concrete", name: "Kimi Default" },
                { value: "kimi-k2.5", name: "Kimi K2.5" },
                { value: "kimi-k3", name: "Kimi K3" },
              ],
            },
          ],
        });
        transports.push(transport);
        return transport;
      },
      createWorkingDirectory: async () => {
        // Flip the setting after the job is accepted but before ACP resolves.
        threadTitleModelId = "kimi-k3";
        return "/private/carrent-title-snapshot-stability";
      },
      removeWorkingDirectory: async () => {},
    });

    coordinator.enqueue({
      threadId: "thread-1",
      runId: "run-1",
      source: "Visible first request",
    });
    await coordinator.waitForIdle();

    // The job configured the model captured at enqueue, not the mutated value.
    expect(transports[0]!.sent).toMatchObject([
      { method: "initialize" },
      { method: "session/new" },
      {
        method: "session/set_config_option",
        params: { configId: "model", value: "kimi-k2.5" },
      },
      { method: "session/prompt" },
    ]);
  });
});
