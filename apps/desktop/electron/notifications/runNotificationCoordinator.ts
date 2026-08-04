// Main Process notification coordinator for background Run outcomes and
// attention requests. One coordinator consumes authoritative Run transitions,
// resolves the owning Thread and its queued work from the current App State
// Snapshot, inspects the focused Carrent Window's route, and invokes a system
// notification adapter. It is the single place that decides whether to show a
// system notification, so peer Renderers cannot race or duplicate.
//
// Content is intentionally minimal: only the Thread title and one concise
// English state label. No message text, Agent Activity, structured questions,
// Approval Request details, commands, paths, Runtime output, or failure
// details ever reach a notification.

import type { ChatRunAuthorityState, SharedChatRunStatus } from "../../src/shared/chat";
import type { AppStateSnapshot, AppThreadRecord } from "../../src/shared/workspacePersistence";

export type RunNotificationKind = "completed" | "failed" | "answer-needed" | "approval-needed";

// The OS-facing label shown as the notification body. Kept short, English, and
// free of any Thread content.
export const RUN_NOTIFICATION_BODY: Record<RunNotificationKind, string> = {
  completed: "Run completed",
  failed: "Run failed",
  "answer-needed": "Answer needed",
  "approval-needed": "Approval needed",
};

export type SystemNotificationContent = {
  title: string;
  body: string;
};

// A handle to one live system notification. `close` dismisses it; `onClick`
// registers the action taken when the user activates the notification.
export type SystemNotificationHandle = {
  close: () => void;
  onClick: (handler: () => void) => void;
};

// A small adapter around the host notification center so the coordinator can
// be tested without the OS. `show` returns null when notifications are
// unsupported, denied, or could not be constructed; the coordinator treats
// that as a silent no-op.
export type SystemNotificationAdapter = {
  isSupported: () => boolean;
  show: (content: SystemNotificationContent) => SystemNotificationHandle | null;
};

// The coordinator's view of Carrent Windows. It does not depend on the full
// peer-window registry, only on the two questions notifications need.
export type NotificationWindowAccess = {
  // The route of the Carrent Window that currently has OS focus, or null when
  // no Carrent Window is focused (app in the background, minimized, hidden, or
  // no window open). Used only for suppression.
  focusedRoute: () => string | null;
  // Focus a Carrent Window already showing the route, otherwise navigate the
  // most-recently-active window to it. Returns false when no Carrent Window
  // exists, signaling the caller to create one.
  routeToThread: (route: string) => boolean;
};

export type RunNotificationCoordinatorOptions = {
  getSnapshot: () => AppStateSnapshot;
  buildThreadRoute: (workspaceId: string, projectId: string, threadId: string) => string;
  windows: NotificationWindowAccess;
  notifications: SystemNotificationAdapter;
  createWindowWithRoute: (route: string) => void;
};

type ThreadTracking = { runId: string; status: SharedChatRunStatus };

export function createRunNotificationCoordinator(options: RunNotificationCoordinatorOptions) {
  // Last authoritative status seen for each Thread's current Run. Keyed by
  // thread so a Run that is replaced (new runId) resets the transition window.
  const trackingByThread = new Map<string, ThreadTracking>();
  // At most one live notification handle per Thread. A later notification for
  // a Thread closes and replaces its earlier handle.
  const handleByThread = new Map<string, SystemNotificationHandle>();

  function resolveThread(
    snapshot: AppStateSnapshot,
    threadId: string,
  ): { thread: AppThreadRecord; route: string } | null {
    const thread = snapshot.threads?.find((item) => item.id === threadId && !item.archived);
    if (!thread) return null;
    return {
      thread,
      route: options.buildThreadRoute(thread.workspaceId, thread.projectId, thread.id),
    };
  }

  // A Thread has automatically continuing queued work when its queue head does
  // not require explicit confirmation — the same predicate the renderer's
  // completion path uses to decide whether to start another Run. Intermediate
  // completion of such a sequence is suppressed so the notification only fires
  // when the queue is actually idle.
  function hasAutoContinuingQueuedWork(snapshot: AppStateSnapshot, threadId: string): boolean {
    const work = snapshot.threadWork;
    if (!work) return false;
    const queue = work[threadId]?.queuedMessages ?? [];
    if (queue.length === 0) return false;
    return queue[0].requiresConfirmation !== true;
  }

  function eligibleKind(
    status: SharedChatRunStatus,
    snapshot: AppStateSnapshot,
    threadId: string,
  ): RunNotificationKind | null {
    if (status === "failed") return "failed";
    if (status === "waiting-for-approval") return "approval-needed";
    if (status === "waiting-for-answer") return "answer-needed";
    if (status === "completed") {
      // Suppress completion while queued work will automatically continue.
      if (hasAutoContinuingQueuedWork(snapshot, threadId)) return null;
      return "completed";
    }
    // starting, running, and cancelled never create a notification.
    return null;
  }

  function closeHandle(threadId: string) {
    const handle = handleByThread.get(threadId);
    if (!handle) return;
    handleByThread.delete(threadId);
    try {
      handle.close();
    } catch {
      // Closing a handle the OS already dismissed is harmless.
    }
  }

  function show(threadId: string, route: string, title: string, kind: RunNotificationKind) {
    // A focused Carrent Window already displaying the Thread makes a system
    // notification redundant.
    if (options.windows.focusedRoute() === route) return;
    if (!options.notifications.isSupported()) return;
    // Replace any earlier live notification for this Thread before showing the
    // current state.
    closeHandle(threadId);
    const handle = options.notifications.show({
      title,
      body: RUN_NOTIFICATION_BODY[kind],
    });
    if (!handle) return;
    handleByThread.set(threadId, handle);
    handle.onClick(() => {
      if (!options.windows.routeToThread(route)) {
        options.createWindowWithRoute(route);
      }
    });
  }

  return {
    // Invoked once per authoritative Run state change. The coordinator diffs
    // each Thread's current Run against the last status it observed and decides
    // one notification per genuine transition.
    onRunStateChanged(state: ChatRunAuthorityState) {
      const snapshot = options.getSnapshot();
      for (const run of state.runs) {
        const threadId = run.threadId;
        const tracked = trackingByThread.get(threadId);
        // A new Run for the Thread (different runId) starts a fresh transition
        // window, so a previous Run's terminal status cannot suppress it.
        const prevStatus = tracked && tracked.runId === run.runId ? tracked.status : null;

        const kind = eligibleKind(run.status, snapshot, threadId);
        // One uniform rule covers every case: notify on a genuine entry into an
        // eligible status. For waiting phases this dedupes additional events in
        // the same phase and fires again after running resets it; for terminal
        // statuses it fires once because a terminal Run cannot re-enter the
        // same terminal status; replayed publications (prev === curr) are
        // suppressed.
        const shouldNotify = kind !== null && prevStatus !== run.status;

        trackingByThread.set(threadId, { runId: run.runId, status: run.status });

        if (!shouldNotify) continue;
        const resolved = resolveThread(snapshot, threadId);
        // A stale or missing Thread produces no notification rather than a
        // generic one without Thread context.
        if (!resolved) continue;
        show(threadId, resolved.route, resolved.thread.title, kind);
      }
    },

    // Exposed for tests and shutdown; not part of the product surface.
    _closeAllForTest() {
      const threadIds = Array.from(handleByThread.keys());
      for (const threadId of threadIds) closeHandle(threadId);
    },
  };
}

export type RunNotificationCoordinator = ReturnType<typeof createRunNotificationCoordinator>;
