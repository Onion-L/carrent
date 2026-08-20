import { describe, expect, it } from "bun:test";

import { resolveThreeLevelRoute } from "../src/renderer/lib/navigation";
import type { ChatTurnRequest } from "../src/shared/chat";
import type { ChatPermissionResponse } from "../src/shared/chatPermissions";
import type { ChatQuestionResponse } from "../src/shared/chatQuestions";
import { DEFAULT_APP_STATE_SETTINGS } from "../src/shared/workspacePersistence";
import { createAppShutdown } from "./appShutdown";
import { handleCarrentWindowActivation } from "./carrentWindowLifecycle";
import { createCarrentWindowRegistry, type CarrentWindowLike } from "./carrentWindowRegistry";
import { captureSession, restoreWindows } from "./carrentWindowSession";
import { openThreadInNewWindow } from "./carrentWindowOpener";
import { createChatRunAuthority } from "./chat/chatRunAuthority";
import { createTerminalSessionManager, type PtyProcess } from "./terminal/terminalSessionManager";
import { createAppStateAuthority } from "./workspace/appStateAuthority";
import { appStateCommandReducers } from "./workspace/appStateCommands";
import { createAppStateStoreStub } from "./workspace/appStateStore.testUtils";

const WINDOW_A = 101;
const WINDOW_B = 202;
const THREAD_ROUTE = "/workspace/workspace-1/project/project-1/thread/thread-1";

class FakePty implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  killed = false;
  private readonly dataListeners = new Set<(data: string) => void>();

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit() {
    return { dispose: () => {} };
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize(columns: number, rows: number) {
    this.resizes.push([columns, rows]);
  }

  kill() {
    this.killed = true;
  }

  emitData(data: string) {
    this.dataListeners.forEach((listener) => listener(data));
  }
}

function createTerminalHarness() {
  const processes: FakePty[] = [];
  const eventsByWindow = new Map<number, unknown[]>();
  const manager = createTerminalSessionManager({
    pty: {
      spawn: () => {
        const process = new FakePty();
        processes.push(process);
        return process;
      },
    },
    emit: (ownerId, event) => {
      eventsByWindow.set(ownerId, [...(eventsByWindow.get(ownerId) ?? []), event]);
    },
    env: { SHELL: "/bin/zsh" },
    isExecutable: () => true,
    createId: () => `terminal-${processes.length + 1}`,
  });
  return { manager, processes, eventsByWindow };
}

function createRunHarness() {
  const starts: string[] = [];
  const stops: string[] = [];
  const permissions: ChatPermissionResponse[] = [];
  const questions: ChatQuestionResponse[] = [];
  const statesByWindow = new Map<number, unknown>();
  const authority = createChatRunAuthority({
    start: (runId) => starts.push(runId),
    stop: (runId) => stops.push(runId),
    respondToPermission: (response) => permissions.push(response),
    respondToQuestion: (response) => questions.push(response),
    publish: (subscriberId, state) => statesByWindow.set(subscriberId, state),
  });
  return { authority, starts, stops, permissions, questions, statesByWindow };
}

function runRequest(runId: string): ChatTurnRequest {
  return {
    runId,
    requestKey: `request-${runId}`,
    context: {
      kind: "project",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workingDirectory: "/work/carrent",
    },
    threadId: "thread-1",
    providerProfileId: "default",
    agentMode: "ask",
    transcript: [],
    message: "verify multi-window",
  };
}

function createWindow(id: number) {
  const actions: string[] = [];
  const navigations: string[] = [];
  let destroyed = false;
  const window: CarrentWindowLike = {
    id,
    isDestroyed: () => destroyed,
    isMinimized: () => false,
    isVisible: () => true,
    restore: () => actions.push("restore"),
    show: () => actions.push("show"),
    hide: () => actions.push("hide"),
    focus: () => actions.push("focus"),
    webContents: {
      send: (channel, path) => {
        if (channel === "app:navigate" && path) navigations.push(path);
      },
    },
  };
  return { window, actions, navigations, destroy: () => (destroyed = true) };
}

function createSharedAppState() {
  const publishedByWindow = new Map<number, unknown>();
  const authority = createAppStateAuthority({
    store: createAppStateStoreStub(),
    initialResult: {
      status: "ready",
      snapshot: {
        version: 1,
        workspaces: [],
        projects: [],
        associations: [],
        threads: [],
        threadDrafts: [],
        threadMessages: [],
        threadRuns: [],
        threadPromotionIntents: [],
        threadWork: {},
        lastThreadIdByWorkspace: {},
        activeWorkspaceId: null,
      },
    },
    reducers: appStateCommandReducers,
    publish: (subscriberId, state) => publishedByWindow.set(subscriberId, state),
  });
  let commandIndex = 0;
  const submit = (windowId: number, type: string, payload: unknown) =>
    authority.submit(windowId, {
      commandId: `command-${++commandIndex}`,
      type,
      payload,
    });

  return { authority, publishedByWindow, submit };
}

function createRendererClient(
  windowId: number,
  appState: ReturnType<typeof createSharedAppState>,
  runs: ReturnType<typeof createRunHarness>,
  terminals: ReturnType<typeof createTerminalHarness>,
) {
  appState.authority.subscribe(windowId);
  runs.authority.subscribe(windowId);
  terminals.manager.subscribe(windowId, "project-1");

  return {
    command: (type: string, payload: unknown) => appState.submit(windowId, type, payload),
    send: (request: ChatTurnRequest) => runs.authority.send(request),
    stop: (runId: string) => runs.authority.stop(runId),
    respondToPermission: (response: ChatPermissionResponse) =>
      runs.authority.respondToPermission(response),
    respondToQuestion: (response: ChatQuestionResponse) =>
      runs.authority.respondToQuestion(response),
    createTerminal: (ensureFirst = false) =>
      terminals.manager.create({
        ownerId: windowId,
        projectId: "project-1",
        projectName: "Carrent",
        workingDirectory: "/work/carrent",
        enhancedCompletion: false,
        ensureFirst,
      }),
    writeTerminal: (terminalId: string, data: string) =>
      terminals.manager.write(windowId, "project-1", terminalId, data),
    focusTerminal: (
      terminalId: string,
      focused: boolean,
      columns: number,
      rows: number,
      generation: number,
    ) =>
      terminals.manager.focus(
        windowId,
        "project-1",
        terminalId,
        focused,
        columns,
        rows,
        generation,
      ),
    resizeTerminal: (terminalId: string, columns: number, rows: number, generation: number) =>
      terminals.manager.resize(windowId, "project-1", terminalId, columns, rows, generation),
    terminalTabs: () => terminals.manager.subscribe(windowId, "project-1"),
    detach: () => terminals.manager.detach(windowId),
    latestAppState: () => appState.publishedByWindow.get(windowId),
    latestRunState: () => runs.statesByWindow.get(windowId),
  };
}

async function createRendererWorkflow() {
  const appState = createSharedAppState();
  const runs = createRunHarness();
  const terminals = createTerminalHarness();
  const clientA = createRendererClient(WINDOW_A, appState, runs, terminals);
  const clientB = createRendererClient(WINDOW_B, appState, runs, terminals);

  await clientA.command("workspace:create", {
    workspace: { id: "workspace-1", name: "Carrent", order: 0 },
    projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/work/carrent" }],
    associations: [
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        order: 0,
        defaultProviderProfileId: "default",
        defaultAgentMode: "ask",
      },
    ],
  });
  return { appState, runs, terminals, clientA, clientB };
}

describe("real multi-window workflows", () => {
  it("keeps two Renderer clients consistent across App State, Runs, and Terminal Tabs", async () => {
    const { appState, runs, terminals, clientA, clientB } = await createRendererWorkflow();
    const draft = {
      id: "draft-1",
      threadId: "thread-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      content: "",
      attachedSkillNames: [],
      attachments: [],
      providerProfileId: "default",
      agentMode: "ask",
    };
    await clientB.command("thread-draft:open", {
      workspaceId: "workspace-1",
      projectId: "project-1",
      draft,
    });
    await clientA.command("thread-draft:update", {
      draftId: draft.id,
      draft: {
        content: "shared draft",
        composerState: '{"root":{}}',
        attachedSkillNames: ["tdd"],
        attachments: [],
      },
    });

    const promotion = {
      draftId: draft.id,
      threadId: draft.threadId,
      thread: {
        id: draft.threadId,
        workspaceId: draft.workspaceId,
        projectId: draft.projectId,
        title: "Multi-window",
        createdAt: "2026-08-01T00:00:00.000Z",
        lastActivityAt: "2026-08-01T00:00:00.000Z",
        providerProfileId: "default",
        agentMode: "ask",
      },
      message: {
        id: "message-1",
        threadId: draft.threadId,
        role: "user",
        content: "shared draft",
        createdAt: "2026-08-01T00:00:00.000Z",
        attachments: [],
      },
      assistantMessage: {
        id: "assistant-1",
        threadId: draft.threadId,
        role: "assistant",
        content: "",
        createdAt: "2026-08-01T00:00:00.000Z",
        attachments: [],
        runStatus: "running",
        runEventCount: 0,
      },
      run: {
        id: "run-record-1",
        threadId: draft.threadId,
        messageId: "message-1",
        assistantMessageId: "assistant-1",
        startedAt: "2026-08-01T00:00:00.000Z",
        providerProfileId: "default",
        agentMode: "ask",
      },
    };
    const promotions = await Promise.all([
      clientA.command("thread-draft:promote", promotion),
      clientB.command("thread-draft:promote", promotion),
    ]);
    expect(
      promotions.filter(
        (result) =>
          result.status === "accepted" &&
          (result.data as { created?: boolean } | undefined)?.created === true,
      ),
    ).toHaveLength(1);

    const finalTimelinePart = {
      type: "agent_activity" as const,
      item: {
        type: "message" as const,
        id: "run-1-message-1",
        order: 0,
        content: "Done.",
        isFinal: true,
      },
    };
    const completedAssistant = {
      ...promotion.assistantMessage,
      content: "Done.",
      parts: [finalTimelinePart],
      runStatus: "completed" as const,
      runEventCount: 3,
    };
    await clientA.command("thread-content:update", {
      threadId: "thread-1",
      messages: [promotion.message, completedAssistant],
    });
    await clientB.command("thread-content:update", {
      threadId: "thread-1",
      messages: [
        promotion.message,
        {
          ...promotion.assistantMessage,
          content: "Done.Done.",
          parts: [finalTimelinePart, finalTimelinePart],
          runEventCount: 2,
        },
      ],
    });

    await clientB.command("thread-work:update", {
      threadId: "thread-1",
      work: {
        draft: { content: "composer from B", attachedSkillNames: [], attachments: [] },
        queuedMessages: [],
      },
    });
    await clientA.command("settings:update", {
      settings: {
        ...DEFAULT_APP_STATE_SETTINGS,
        theme: "light",
        fontSizeInterface: 17,
      },
    });

    const sends = [clientA.send(runRequest("run-a")), clientB.send(runRequest("run-b"))];
    expect(sends.filter((result) => result.accepted)).toHaveLength(1);
    const runId = sends.find((result) => result.accepted)!.runId!;
    runs.authority.handleEvent({ type: "started", runId, threadId: "thread-1" });
    runs.authority.handleEvent({ type: "delta", runId, text: "streamed to both" });
    runs.authority.handleEvent({
      type: "permission-requested",
      runId,
      permission: {
        id: "permission-1",
        runId,
        threadId: "thread-1",
        provider: "core",
        action: "shell",
        title: "Run command",
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        createdAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:01:00.000Z",
      },
    });
    const permission = { permissionId: "permission-1", runId, optionId: "allow" };
    expect(
      [clientA.respondToPermission(permission), clientB.respondToPermission(permission)].filter(
        (result) => result.accepted,
      ),
    ).toHaveLength(1);
    runs.authority.handleEvent({
      type: "question-requested",
      runId,
      question: {
        id: "question-1",
        runId,
        threadId: "thread-1",
        provider: "core",
        source: "core",
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
    const answer: ChatQuestionResponse = {
      questionId: "question-1",
      runId,
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["yes"] }],
    };
    expect(
      [clientA.respondToQuestion(answer), clientB.respondToQuestion(answer)].filter(
        (result) => result.accepted,
      ),
    ).toHaveLength(1);
    expect(
      [clientA.stop(runId), clientB.stop(runId)].filter((result) => result.accepted),
    ).toHaveLength(1);

    const terminalA = clientA.createTerminal(true);
    const terminalB = clientB.createTerminal(true);
    expect(terminalB.id).toBe(terminalA.id);
    clientB.writeTerminal(terminalA.id, "pwd\r");
    terminals.processes[0]!.emitData("/work/carrent\r\n");
    clientA.focusTerminal(terminalA.id, true, 100, 30, 1);
    clientB.focusTerminal(terminalA.id, true, 90, 24, 1);
    clientA.resizeTerminal(terminalA.id, 120, 40, 1);
    clientB.resizeTerminal(terminalA.id, 91, 25, 1);

    const snapshot = appState.authority.getState().snapshot;
    expect(snapshot).toMatchObject({
      workspaces: [{ id: "workspace-1" }],
      projects: [{ id: "project-1" }],
      associations: [{ workspaceId: "workspace-1", projectId: "project-1" }],
      threads: [{ id: "thread-1" }],
      threadDrafts: [],
      settings: { theme: "light", fontSizeInterface: 17 },
    });
    expect(snapshot.threadWork?.["thread-1"]?.draft?.content).toBe("composer from B");
    expect(snapshot.threadMessages?.find((message) => message.id === "assistant-1")).toMatchObject({
      content: "Done.",
      parts: [finalTimelinePart],
      runStatus: "completed",
      runEventCount: 3,
    });
    expect(clientA.latestAppState()).toEqual(clientB.latestAppState());
    expect(clientA.latestRunState()).toEqual(clientB.latestRunState());
    expect(clientA.terminalTabs()).toEqual(clientB.terminalTabs());
    expect(terminals.eventsByWindow.get(WINDOW_A)).toEqual(terminals.eventsByWindow.get(WINDOW_B));
    expect(terminals.processes[0]!.writes).toEqual(["pwd\r"]);
    expect(terminals.processes[0]!.resizes).toEqual([
      [100, 30],
      [90, 24],
      [91, 25],
    ]);
  });

  it("redirects each affected window after deletion without stale-state resurrection", async () => {
    const { appState, clientA, clientB } = await createRendererWorkflow();
    await clientA.command("thread-draft:open", {
      workspaceId: "workspace-1",
      projectId: "project-1",
      draft: {
        id: "draft-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        content: "",
        attachedSkillNames: [],
        attachments: [],
        providerProfileId: "default",
        agentMode: "ask",
      },
    });

    const removals = await Promise.all([
      clientA.command("association:remove", {
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
      clientB.command("association:remove", {
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
    ]);
    expect(removals.filter((result) => result.status === "accepted")).toHaveLength(1);

    const staleUpdate = await clientB.command("thread-draft:update", {
      draftId: "draft-1",
      draft: { content: "stale", attachedSkillNames: [], attachments: [] },
    });
    expect(staleUpdate).toMatchObject({ status: "rejected", reason: "invalid" });
    expect(appState.authority.getState().snapshot).toMatchObject({
      projects: [],
      associations: [],
      threads: [],
      threadDrafts: [],
    });

    const registry = createCarrentWindowRegistry({ platform: "darwin" });
    const first = createWindow(WINDOW_A);
    const second = createWindow(WINDOW_B);
    registry.register(first.window);
    registry.register(second.window);
    registry.markReady(WINDOW_A);
    registry.markReady(WINDOW_B);
    registry.setRoute(WINDOW_A, THREAD_ROUTE);
    registry.setRoute(WINDOW_B, THREAD_ROUTE);
    const state = appState.authority.getState().snapshot;
    for (const windowId of [WINDOW_A, WINDOW_B]) {
      const route = registry.getRoute(windowId)!;
      const resolution = resolveThreeLevelRoute(
        {
          workspaces: state.workspaces,
          projects: state.projects,
          associations: state.associations,
          threads: state.threads ?? [],
        },
        route,
      );
      expect(resolution).toMatchObject({
        kind: "fallback",
        to: "/workspace/workspace-1",
      });
      if (resolution.kind === "fallback") registry.deliverNavigation(windowId, resolution.to);
    }
    expect(first.navigations).toEqual(["/workspace/workspace-1"]);
    expect(second.navigations).toEqual(["/workspace/workspace-1"]);
  });

  it("keeps live resources through peer closure and only ends them on confirmed Quit", async () => {
    const { runs, terminals, clientA, clientB } = await createRendererWorkflow();
    const registry = createCarrentWindowRegistry({ platform: "darwin" });
    const first = createWindow(WINDOW_A);
    const second = createWindow(WINDOW_B);
    registry.register(first.window);
    registry.register(second.window);
    registry.markReady(WINDOW_A);
    registry.markReady(WINDOW_B);
    registry.setRoute(WINDOW_A, THREAD_ROUTE);
    registry.setRoute(WINDOW_B, "/settings/general");
    registry.setActive(WINDOW_B);

    expect(registry.handleSecondInstance([])).toEqual({ needsWindow: false, route: null });
    expect(second.actions).toEqual(["focus"]);
    registry.handleOpenUrl("carrent://workspace/workspace-1/project/project-1/thread/thread-1");
    expect(first.actions).toEqual(["focus"]);

    clientA.send(runRequest("run-1"));
    const tab = clientA.createTerminal();

    expect(registry.decideClose(WINDOW_A)).toEqual({ kind: "close" });
    registry.unregister(WINDOW_A);
    clientA.detach();
    expect(runs.authority.getState().runs[0]?.status).toBe("starting");
    expect(clientB.terminalTabs().tabs).toHaveLength(1);
    expect(terminals.processes[0]!.killed).toBe(false);

    const session = captureSession(
      [
        {
          id: WINDOW_B,
          route: registry.getRoute(WINDOW_B),
          bounds: { x: 40, y: 60, width: 1200, height: 800 },
          maximized: true,
        },
      ],
      { now: () => new Date("2026-08-01T00:00:00.000Z") },
    );
    expect(registry.decideClose(WINDOW_B)).toEqual({ kind: "destroy" });
    registry.unregister(WINDOW_B);
    clientB.detach();
    let recoveredWindows = 0;
    handleCarrentWindowActivation({
      windowCount: () => registry.count(),
      createRecoveredWindow: () => (recoveredWindows += 1),
      focusMostRecent: () => registry.focusMostRecent(),
    });
    expect(recoveredWindows).toBe(1);
    expect(terminals.processes[0]!.killed).toBe(false);

    let quitCalls = 0;
    let allowQuit = false;
    const shutdown = createAppShutdown({
      quit: () => (quitCalls += 1),
      liveRunQuitPolicy: {
        hasLiveRuns: () => true,
        confirmQuitWithLiveRuns: async () => allowQuit,
        cancelLiveRuns: async () => {
          runs.authority.stop("run-1");
        },
      },
      beforeSave: async () => terminals.manager.shutdown(),
    });
    const event = { preventDefault: () => {} };
    await shutdown.beforeQuit(event);
    expect(quitCalls).toBe(0);
    expect(runs.stops).toEqual([]);
    expect(runs.authority.getState().runs[0]?.status).toBe("starting");
    expect(terminals.processes[0]!.killed).toBe(false);
    allowQuit = true;
    await shutdown.beforeQuit(event);
    expect(quitCalls).toBe(1);
    expect(runs.stops).toEqual(["run-1"]);
    expect(terminals.processes[0]!.killed).toBe(true);

    const restored = restoreWindows(session);
    expect(restored).toEqual([
      {
        route: "/settings/general",
        bounds: { x: 40, y: 60, width: 1200, height: 800 },
        maximized: true,
      },
    ]);
    const restartedTerminals = createTerminalHarness();
    restartedTerminals.manager.subscribe(WINDOW_B, "project-1");
    expect(restartedTerminals.manager.list(WINDOW_B, "project-1")).toEqual([]);

    const errors: string[] = [];
    openThreadInNewWindow({
      route: THREAD_ROUTE,
      source: { isDestroyed: () => false, reportOpenError: (message) => errors.push(message) },
      create: () => {
        throw new Error("BrowserWindow creation failed");
      },
    });
    expect(errors).toEqual(["BrowserWindow creation failed"]);
    expect(registry.count()).toBe(0);
    expect(tab.id).toBe("terminal-1");
  });
});
