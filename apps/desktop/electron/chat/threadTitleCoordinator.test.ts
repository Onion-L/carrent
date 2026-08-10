import { describe, expect, it } from "bun:test";

import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  APP_STATE_SNAPSHOT_VERSION,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { createAppStateAuthority } from "../workspace/appStateAuthority";
import { appStateCommandReducers } from "../workspace/appStateCommands";
import { createAppStateStoreStub } from "../workspace/appStateStore.testUtils";
import type { KimiAcpTransport } from "./kimiAcpChat";
import { createThreadTitleCoordinator } from "./threadTitleCoordinator";

type JsonObject = Record<string, unknown>;

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

class FakeTitleTransport implements KimiAcpTransport {
  readonly sent: JsonObject[] = [];
  closeCount = 0;
  private messageListener: (message: JsonObject) => void = () => {};
  private errorListener: (error: Error) => void = () => {};
  private closeListener: Parameters<KimiAcpTransport["onClose"]>[0] = () => {};

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
    if (method === this.behavior.hangOn) return;
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
      for (const request of this.behavior.agentRequests ?? []) {
        this.messageListener(request);
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
      this.reply(message, { stopReason: "end_turn" });
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

  private reply(request: JsonObject, result: unknown) {
    this.messageListener({ jsonrpc: "2.0", id: request.id, result });
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

describe("createThreadTitleCoordinator", () => {
  it("runs one isolated Kimi ACP title request and commits the validated title", async () => {
    const published: Array<{ subscriberId: number; snapshot: AppStateSnapshot }> = [];
    const authority = createAppStateAuthority({
      store: createAppStateStoreStub(),
      initialResult: { status: "ready", snapshot: makeSnapshot() },
      reducers: appStateCommandReducers,
      publish: (subscriberId, state) => published.push({ subscriberId, snapshot: state.snapshot }),
    });
    authority.subscribe(11);
    authority.subscribe(22);

    const transports: Array<{ cwd: string; transport: FakeTitleTransport }> = [];
    const removedDirectories: string[] = [];
    const commands: AppStateCommand[] = [];
    const coordinator = createThreadTitleCoordinator({
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

  it("applies Han grapheme length rules", async () => {
    expect(await commandsForOutput('{"title":"修复标题"}')).toHaveLength(0);

    const accepted = await commandsForOutput('{"title":"修复桌面标题生成"}');
    expect(accepted[0]?.payload).toMatchObject({ title: "修复桌面标题生成" });

    const longTitle = "这是一个超过十八个字的自动生成会话标题用于测试截断";
    const truncated = await commandsForOutput(JSON.stringify({ title: longTitle }));
    const expected = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(longTitle)]
      .slice(0, 18)
      .map((entry) => entry.segment)
      .join("");
    expect(truncated[0]?.payload).toMatchObject({ title: expected });
  });

  it("applies non-Han whitespace-delimited word rules", async () => {
    expect(await commandsForOutput('{"title":"Improve navigation"}')).toHaveLength(0);

    const accepted = await commandsForOutput(
      '{"title":"Improve desktop thread title generation flow now please"}',
    );
    expect(accepted[0]?.payload).toMatchObject({
      title: "Improve desktop thread title generation flow now please",
    });

    const truncated = await commandsForOutput(
      '{"title":"Improve the desktop automatic thread title generation flow now please"}',
    );
    expect(truncated[0]?.payload).toMatchObject({
      title: "Improve the desktop automatic thread title generation flow",
    });
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
});
