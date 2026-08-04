import { describe, expect, it } from "bun:test";

import type {
  ChatRunAuthorityState,
  SharedChatRun,
  SharedChatRunStatus,
} from "../../src/shared/chat";
import type { AppStateSnapshot, AppThreadRecord } from "../../src/shared/workspacePersistence";
import {
  createRunNotificationCoordinator,
  type RunNotificationCoordinator,
  type SystemNotificationAdapter,
  type SystemNotificationHandle,
} from "./runNotificationCoordinator";

type FakeNotification = {
  id: number;
  content: { title: string; body: string };
  closed: boolean;
  clickHandlers: Array<() => void>;
};

type FakeWindowAccess = {
  focusedRouteValue: string | null;
  routeResult: boolean;
  routedTo: string[];
};

function makeThread(overrides: Partial<AppThreadRecord> = {}): AppThreadRecord {
  return {
    id: "thread-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    title: "Tidy the docs",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
    ...overrides,
  };
}

function emptySnapshot(threads: AppThreadRecord[] = []): AppStateSnapshot {
  return {
    version: 1,
    workspaces: [],
    projects: [],
    associations: [],
    threads,
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: null,
  };
}

function snapshotWithQueue(
  thread: AppThreadRecord,
  queued: Array<{ id: string; content: string; requiresConfirmation?: boolean }>,
): AppStateSnapshot {
  return {
    ...emptySnapshot([thread]),
    threadWork: {
      [thread.id]: {
        queuedMessages: queued.map((item) => ({
          id: item.id,
          content: item.content,
          ...(item.requiresConfirmation === undefined
            ? {}
            : { requiresConfirmation: item.requiresConfirmation }),
        })),
      },
    },
  };
}

function makeRun(threadId: string, status: SharedChatRunStatus, runId = "run-1"): SharedChatRun {
  return {
    runId,
    threadId,
    status,
    stopRequested: false,
    events: [],
    pendingPermissions: [],
    pendingQuestions: [],
  };
}

function stateOf(runs: SharedChatRun[]): ChatRunAuthorityState {
  return { revision: 1, runs };
}

function threadRoute(thread: AppThreadRecord) {
  return `/workspace/${thread.workspaceId}/project/${thread.projectId}/thread/${thread.id}`;
}

function createFakeNotifications(supported = true) {
  const notifications: FakeNotification[] = [];
  let counter = 0;
  const adapter: SystemNotificationAdapter = {
    isSupported: () => supported,
    show(content) {
      if (!supported) return null;
      counter += 1;
      const fake: FakeNotification = {
        id: counter,
        content: { title: content.title, body: content.body },
        closed: false,
        clickHandlers: [],
      };
      notifications.push(fake);
      const handle: SystemNotificationHandle = {
        close: () => {
          fake.closed = true;
        },
        onClick: (handler: () => void) => {
          fake.clickHandlers.push(handler);
        },
      };
      return handle;
    },
  };
  return { adapter, notifications };
}

function createWindowAccess(focusedRoute: string | null = null) {
  const access: FakeWindowAccess & {
    windows: {
      focusedRoute: () => string | null;
      routeToThread: (route: string) => boolean;
    };
  } = {
    focusedRouteValue: focusedRoute,
    routeResult: true,
    routedTo: [],
    windows: {
      focusedRoute: () => access.focusedRouteValue,
      routeToThread: (route: string) => {
        access.routedTo.push(route);
        return access.routeResult;
      },
    },
  };
  return access;
}

function createCoordinator({
  snapshot,
  getSnapshot,
  notifications,
  windows,
  createdRoutes,
}: {
  snapshot?: AppStateSnapshot;
  getSnapshot?: () => AppStateSnapshot;
  notifications: ReturnType<typeof createFakeNotifications>;
  windows: ReturnType<typeof createWindowAccess>;
  createdRoutes: string[];
}): RunNotificationCoordinator {
  return createRunNotificationCoordinator({
    getSnapshot: getSnapshot ?? (() => snapshot as AppStateSnapshot),
    buildThreadRoute: (workspaceId, projectId, threadId) =>
      `/workspace/${workspaceId}/project/${projectId}/thread/${threadId}`,
    windows: windows.windows,
    notifications: notifications.adapter,
    createWindowWithRoute: (route) => {
      createdRoutes.push(route);
    },
  });
}

describe("runNotificationCoordinator — completion and failure (issue 01)", () => {
  it("notifies when a background Run completes", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null); // no focused window
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));

    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].content).toEqual({
      title: "Tidy the docs",
      body: "Run completed",
    });
  });

  it("notifies when a background Run fails", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "failed")]));

    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].content.body).toBe("Run failed");
  });

  it("suppresses completion when the focused window displays the exact Thread route", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(threadRoute(thread));
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("suppresses failure when the focused window displays the exact Thread route", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(threadRoute(thread));
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "failed")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("does not suppress when focused on a different Thread", () => {
    const thread = makeThread();
    const other = makeThread({ id: "thread-2", title: "Other" });
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(threadRoute(other));
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread, other]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));

    expect(notifications.notifications).toHaveLength(1);
  });

  it("never notifies on a cancelled Run", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "cancelled")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("does not notify on running or starting transitions", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "starting")]));
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "running")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("produces no notification when the owning Thread is missing or archived", () => {
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      // Thread not present in the snapshot at all.
      snapshot: emptySnapshot([]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun("ghost-thread", "completed")]));
    coordinator._closeAllForTest();

    const archived = makeThread({ id: "archived-thread", archived: true });
    const coordinator2 = createCoordinator({
      snapshot: emptySnapshot([archived]),
      notifications,
      windows,
      createdRoutes,
    });
    coordinator2.onRunStateChanged(stateOf([makeRun("archived-thread", "completed")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("treats unsupported notifications and denied delivery as silent no-ops", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications(false); // unsupported
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("fires one notification per transition regardless of repeated publication", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    const completed = stateOf([makeRun(thread.id, "completed")]);
    coordinator.onRunStateChanged(completed);
    coordinator.onRunStateChanged(completed);
    coordinator.onRunStateChanged(completed);

    expect(notifications.notifications).toHaveLength(1);
  });

  it("excludes message content, paths, commands, and error details from the notification", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "failed")]));

    const body = notifications.notifications[0].content.body;
    // Only the concise state label; no secret details.
    expect(body).toBe("Run failed");
    expect(JSON.stringify(notifications.notifications[0].content)).not.toContain("/repo");
    expect(JSON.stringify(notifications.notifications[0].content)).not.toContain("rm -rf");
  });
});

describe("runNotificationCoordinator — attention requests (issue 02)", () => {
  it("notifies once when a Run enters waiting-for-answer", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    const waiting = stateOf([makeRun(thread.id, "waiting-for-answer")]);
    coordinator.onRunStateChanged(waiting);
    // Additional publication while still in the same waiting phase does not
    // create another notification.
    coordinator.onRunStateChanged(waiting);

    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].content.body).toBe("Answer needed");
  });

  it("notifies once when a Run enters waiting-for-approval", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "waiting-for-approval")]));

    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].content.body).toBe("Approval needed");
  });

  it("notifies again after running resets a waiting phase and a later transition occurs", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    const runId = "run-1";
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "waiting-for-answer", runId)]));
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "running", runId)]));
    // A later, distinct waiting transition is independently eligible.
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "waiting-for-answer", runId)]));

    expect(notifications.notifications).toHaveLength(2);
  });

  it("replaces an earlier attention notification with the current approval-needed state", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    const runId = "run-1";
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "waiting-for-answer", runId)]));
    const first = notifications.notifications[0];
    // A distinct transition to approval replaces the answer notification.
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "waiting-for-approval", runId)]));

    expect(notifications.notifications).toHaveLength(2);
    expect(notifications.notifications[1].content.body).toBe("Approval needed");
    // The earlier handle was closed before the replacement was shown.
    expect(first.closed).toBe(true);
  });

  it("closes only the replaced Thread's notification, leaving other Threads intact", () => {
    const threadA = makeThread({ id: "thread-a", title: "Thread A" });
    const threadB = makeThread({ id: "thread-b", title: "Thread B" });
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([threadA, threadB]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(
      stateOf([
        makeRun(threadA.id, "waiting-for-answer", "run-a"),
        makeRun(threadB.id, "waiting-for-answer", "run-b"),
      ]),
    );
    expect(notifications.notifications).toHaveLength(2);
    const aNotification = notifications.notifications[0];
    const bNotification = notifications.notifications[1];

    // Thread A transitions to approval; only its handle is replaced.
    coordinator.onRunStateChanged(
      stateOf([
        makeRun(threadA.id, "waiting-for-approval", "run-a"),
        makeRun(threadB.id, "waiting-for-answer", "run-b"),
      ]),
    );

    expect(aNotification.closed).toBe(true);
    expect(bNotification.closed).toBe(false);
    expect(notifications.notifications).toHaveLength(3);
  });
});

describe("runNotificationCoordinator — click routing (issue 03)", () => {
  it("routes to the Thread via existing windows without creating one", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));
    notifications.notifications[0].clickHandlers.forEach((handler) => handler());

    expect(windows.routedTo).toEqual([threadRoute(thread)]);
    expect(createdRoutes).toEqual([]);
  });

  it("creates a recovered window when no Carrent Window exists", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    windows.routeResult = false; // no window to reuse
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));
    notifications.notifications[0].clickHandlers.forEach((handler) => handler());

    expect(createdRoutes).toEqual([threadRoute(thread)]);
  });

  it("keeps at most one live notification per Thread, replacing obsolete state", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: emptySnapshot([thread]),
      notifications,
      windows,
      createdRoutes,
    });

    const runId = "run-1";
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "waiting-for-answer", runId)]));
    // Responding and the Run finishing produces a completion notification that
    // replaces the earlier attention notification for the Thread.
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed", runId)]));

    expect(notifications.notifications).toHaveLength(2);
    expect(notifications.notifications[0].closed).toBe(true);
    expect(notifications.notifications[1].content.body).toBe("Run completed");
  });
});

describe("runNotificationCoordinator — queued work (issue 04)", () => {
  it("suppresses completion while a queued message will automatically continue", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: snapshotWithQueue(thread, [
        { id: "q1", content: "next", requiresConfirmation: false },
      ]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("suppresses intermediate completions across several auto-continuing messages", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const holder: { current: AppStateSnapshot } = {
      current: snapshotWithQueue(thread, [
        { id: "q1", content: "first", requiresConfirmation: false },
        { id: "q2", content: "second", requiresConfirmation: false },
      ]),
    };
    const coordinator = createRunNotificationCoordinator({
      getSnapshot: () => holder.current,
      buildThreadRoute: (w, p, t) => `/workspace/${w}/project/${p}/thread/${t}`,
      windows: windows.windows,
      notifications: notifications.adapter,
      createWindowWithRoute: (route) => createdRoutes.push(route),
    });

    // First Run completes with the queue still holding auto-continuing work.
    const runId = "run-1";
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed", runId)]));
    // A new Run starts and completes; the head still auto-continues.
    holder.current = snapshotWithQueue(thread, [
      { id: "q2", content: "second", requiresConfirmation: false },
    ]);
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "running", "run-2")]));
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed", "run-2")]));

    expect(notifications.notifications).toHaveLength(0);
  });

  it("notifies once after the queue drains and no auto-continuing work remains", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const holder: { current: AppStateSnapshot } = {
      current: snapshotWithQueue(thread, [
        { id: "q1", content: "next", requiresConfirmation: false },
      ]),
    };
    const coordinator = createRunNotificationCoordinator({
      getSnapshot: () => holder.current,
      buildThreadRoute: (w, p, t) => `/workspace/${w}/project/${p}/thread/${t}`,
      windows: windows.windows,
      notifications: notifications.adapter,
      createWindowWithRoute: (route) => createdRoutes.push(route),
    });

    const runId = "run-1";
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed", runId)]));
    expect(notifications.notifications).toHaveLength(0);

    // The queue head has been consumed; completion now reflects an idle queue.
    holder.current = emptySnapshot([thread]);
    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed", "run-2")]));

    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].content.body).toBe("Run completed");
  });

  it("does not treat a confirmation-required queued message as auto-continuing", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: snapshotWithQueue(thread, [
        { id: "q1", content: "needs-send", requiresConfirmation: true },
      ]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "completed")]));

    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].content.body).toBe("Run completed");
  });

  it("notifies immediately on failure during a queued sequence", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: snapshotWithQueue(thread, [
        { id: "q1", content: "next", requiresConfirmation: false },
      ]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "failed")]));

    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].content.body).toBe("Run failed");
  });

  it("remains silent on cancellation during a queued sequence", () => {
    const thread = makeThread();
    const notifications = createFakeNotifications();
    const windows = createWindowAccess(null);
    const createdRoutes: string[] = [];
    const coordinator = createCoordinator({
      snapshot: snapshotWithQueue(thread, [
        { id: "q1", content: "next", requiresConfirmation: false },
      ]),
      notifications,
      windows,
      createdRoutes,
    });

    coordinator.onRunStateChanged(stateOf([makeRun(thread.id, "cancelled")]));

    expect(notifications.notifications).toHaveLength(0);
  });
});
