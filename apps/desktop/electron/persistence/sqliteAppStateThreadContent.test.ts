import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  APP_STATE_SNAPSHOT_VERSION,
  normalizeAppStateSnapshotForMemory,
  type AppThreadMessageRecord,
  type AppThreadRecord,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { appStateCommandReducers } from "../workspace/appStateCommands";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore, type SqliteAppStateStore } from "./sqliteAppStateStore";

// A workspace + project + association. The "active" thread has a small message
// history; "history" thread carries a large unrelated message history so the
// "fixed changed-row count regardless of history" assertion is meaningful.
const ACTIVE_THREAD_ID = "thread-active";
const HISTORY_THREAD_ID = "thread-history";
const UNRELATED_HISTORY_MESSAGES = 20;

function baseSnapshot(): AppStateSnapshot {
  const messages: AppThreadMessageRecord[] = [];
  // The active thread's first user message (referenced by run-active) plus its
  // assistant placeholder for a live run.
  messages.push({
    id: "message-active-user",
    threadId: ACTIVE_THREAD_ID,
    role: "user",
    content: "first turn",
    createdAt: "2026-08-09T08:00:00.000Z",
    attachments: [],
  });
  messages.push({
    id: "message-active-existing",
    threadId: ACTIVE_THREAD_ID,
    role: "assistant",
    content: "",
    createdAt: "2026-08-09T08:00:00.000Z",
    attachments: [],
    runStatus: "running",
    runEventCount: 5,
  });
  // A large unrelated history on a different thread.
  for (let index = 0; index < UNRELATED_HISTORY_MESSAGES; index += 1) {
    messages.push({
      id: `message-history-${index}`,
      threadId: HISTORY_THREAD_ID,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `history ${index}`,
      createdAt: `2026-08-0${(index % 9) + 1}T0${(index % 9) + 1}:00:00.000Z`,
      attachments: [],
    });
  }
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [{ id: "workspace-a", name: "Work", order: 0 }],
    projects: [{ id: "project-a", name: "Carrent", workingDirectory: "/work/carrent" }],
    associations: [
      {
        workspaceId: "workspace-a",
        projectId: "project-a",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "auto-accept-edits",
      },
    ],
    threads: [
      {
        id: ACTIVE_THREAD_ID,
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "Active thread",
        createdAt: "2026-08-09T08:00:00.000Z",
        lastActivityAt: "2026-08-09T08:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
      {
        id: HISTORY_THREAD_ID,
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "History thread",
        createdAt: "2026-08-01T08:00:00.000Z",
        lastActivityAt: "2026-08-01T08:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadDrafts: [],
    threadMessages: messages,
    threadRuns: [
      {
        id: "run-active",
        threadId: ACTIVE_THREAD_ID,
        messageId: "message-active-user",
        assistantMessageId: "message-active-existing",
        startedAt: "2026-08-09T08:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
    ],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    settings: {
      autoDetectRuntimes: true,
      theme: "system",
      typographyMode: "simple",
      fontFamilySans: "",
      fontFamilyComposer: "",
      fontFamilyCode: "",
      fontFamilyTerminal: "",
      fontSizeInterface: 15,
      fontSizePrompt: 14,
      fontSizeCode: 13,
      fontSizeTerminal: 12,
      fontSmoothing: true,
      terminalFontForce: false,
      defaultEditorId: "",
      enhancedTerminalCompletion: true,
      terminalPanelHeight: 320,
      runtimeEnabledById: {},
      runtimeDefaultModelById: {},
    } as NonNullable<AppStateSnapshot["settings"]>,
    lastThreadIdByWorkspace: { "workspace-a": ACTIVE_THREAD_ID },
    activeWorkspaceId: "workspace-a",
  };
}

function command(type: string, payload?: unknown): AppStateCommand {
  return { commandId: `command:${type}:${Math.random().toString(36).slice(2)}`, type, payload };
}

function reduce(before: AppStateSnapshot, value: AppStateCommand): AppStateSnapshot {
  const produced = appStateCommandReducers[value.type]?.(before, value.payload);
  if (!produced) throw new Error(`Fixture command was rejected: ${value.type}`);
  const next = "snapshot" in produced ? produced.snapshot : produced;
  const normalized = normalizeAppStateSnapshotForMemory(next);
  if (!normalized) throw new Error(`Fixture command produced invalid state: ${value.type}`);
  return normalized;
}

// Order-independent comparison for messages that share a `createdAt`: the
// repository reads `thread_messages` ordered by `(thread_id, created_at, id)`,
// while the in-memory `after` keeps the reducer's append order. Comparing the
// sorted sets proves both sides carry the same rows without coupling the test
// to the database's tie-break ordering.
function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

// A write audit over the Thread-lifecycle tables so each test proves the actual
// INSERT/UPDATE/DELETE scope, not just the final row contents.
const AUDIT_TABLES: Array<[string, (row: "OLD" | "NEW") => string]> = [
  ["threads", (row) => `${row}.id`],
  ["thread_messages", (row) => `${row}.id`],
  ["thread_runs", (row) => `${row}.id`],
  ["thread_actions", (row) => `${row}.id`],
  ["thread_work", (row) => `${row}.thread_id`],
  ["workspace_last_threads", (row) => `${row}.workspace_id`],
];

async function installWriteAudit(store: SqliteAppStateStore): Promise<void> {
  await store.run((client) => {
    client.run("CREATE TEMP TABLE content_write_audit (entry TEXT NOT NULL)");
    for (const [table, key] of AUDIT_TABLES) {
      for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
        const row = operation === "DELETE" ? "OLD" : "NEW";
        client.run(
          `CREATE TEMP TRIGGER content_audit_${table}_${operation.toLowerCase()}
           AFTER ${operation} ON ${table}
           BEGIN
             INSERT INTO content_write_audit (entry)
             VALUES ('${table}:${operation.toLowerCase()}:' || ${key(row)});
           END`,
        );
      }
    }
  });
}

async function auditedEntries(store: SqliteAppStateStore): Promise<string[]> {
  return store.run((client) =>
    client
      .all<{ entry: string }>("SELECT entry FROM content_write_audit ORDER BY entry")
      .map((row) => row.entry),
  );
}

async function clearAudit(store: SqliteAppStateStore): Promise<void> {
  await store.run((client) => client.run("DELETE FROM content_write_audit"));
}

async function withStore(
  before: AppStateSnapshot,
  run: (store: SqliteAppStateStore, before: AppStateSnapshot) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-content-"));
  const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
    driver: bunSqliteDriver,
  });
  try {
    await store.open();
    await store.saveAppStateSnapshot(before);
    await installWriteAudit(store);
    await run(store, before);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function sortedThreadMessages(
  snapshot: AppStateSnapshot | null,
  threadId: string,
): AppThreadMessageRecord[] {
  return [...(snapshot?.threadMessages ?? [])]
    .filter((message) => message.threadId === threadId)
    .sort(byId);
}

function threadById(
  snapshot: AppStateSnapshot | null,
  threadId: string,
): AppThreadRecord | undefined {
  return (snapshot?.threads ?? []).find((thread) => thread.id === threadId);
}

describe("SQLite App State Thread content & Run incremental persistence", () => {
  it("archives one thread and clears the remembered location it pointed at", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const value = command("thread:archive", { threadId: ACTIVE_THREAD_ID });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      expect(threadById(await store.loadAppStateSnapshot(), ACTIVE_THREAD_ID)?.archived).toBe(true);
      expect(await auditedEntries(store)).toEqual([
        "threads:update:thread-active",
        "workspace_last_threads:delete:workspace-a",
      ]);
    });
  });

  it("restores one thread with a single thread row write", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      // First archive so restore has a genuine effect.
      const archived = reduce(before, command("thread:archive", { threadId: ACTIVE_THREAD_ID }));
      await store.persistAppStateCommand(
        command("thread:archive", { threadId: ACTIVE_THREAD_ID }),
        before,
        archived,
      );
      await clearAudit(store);

      const value = command("thread:restore", { threadId: ACTIVE_THREAD_ID });
      const after = reduce(archived, value);
      await store.persistAppStateCommand(value, archived, after);

      expect(threadById(await store.loadAppStateSnapshot(), ACTIVE_THREAD_ID)?.archived).toBe(
        undefined,
      );
      expect(await auditedEntries(store)).toEqual(["threads:update:thread-active"]);
    });
  });

  it("updates one thread's runtime config with a single thread row write", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const value = command("thread:update-config", {
        threadId: ACTIVE_THREAD_ID,
        config: {
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "full-access",
          planMode: true,
        },
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(threadById(loaded, ACTIVE_THREAD_ID)?.runtimeMode).toBe("full-access");
      // Unrelated history is untouched.
      expect(await auditedEntries(store)).toEqual(["threads:update:thread-active"]);
    });
  });

  it("records a run, appending new messages and bumping activity time", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      // The active thread already has the first user message, so record-run
      // dedupes it and only appends the next assistant placeholder + run.
      const value = command("thread:record-run", {
        threadId: ACTIVE_THREAD_ID,
        message: {
          id: "message-active-user-2",
          threadId: ACTIVE_THREAD_ID,
          role: "user",
          content: "second turn",
          createdAt: "2026-08-09T08:30:00.000Z",
          attachments: [],
        },
        assistantMessage: {
          id: "message-active-assistant-next",
          threadId: ACTIVE_THREAD_ID,
          role: "assistant",
          content: "",
          createdAt: "2026-08-09T08:30:00.000Z",
          attachments: [],
          runStatus: "running",
          runEventCount: 0,
        },
        run: {
          id: "run-next",
          threadId: ACTIVE_THREAD_ID,
          messageId: "message-active-user-2",
          assistantMessageId: "message-active-assistant-next",
          startedAt: "2026-08-09T08:30:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      // The new user message and assistant placeholder are appended, the run is
      // recorded, and the thread activity time advances.
      expect(threadById(loaded, ACTIVE_THREAD_ID)?.lastActivityAt).toBe("2026-08-09T08:30:00.000Z");
      expect(loaded?.threadRuns?.map((run) => run.id)).toContain("run-next");
      expect(await auditedEntries(store)).toEqual([
        "thread_messages:insert:message-active-assistant-next",
        "thread_messages:insert:message-active-user-2",
        "thread_runs:insert:run-next",
        "threads:update:thread-active",
      ]);
    });
  });

  it("records a run without re-inserting an already-present user message", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      // The base snapshot already has the first user message, so record-run
      // dedupes it and only appends the next assistant placeholder + run.
      const value = command("thread:record-run", {
        threadId: ACTIVE_THREAD_ID,
        message: {
          id: "message-active-user",
          threadId: ACTIVE_THREAD_ID,
          role: "user",
          content: "first turn",
          createdAt: "2026-08-09T08:00:00.000Z",
          attachments: [],
        },
        assistantMessage: {
          id: "message-active-assistant-next",
          threadId: ACTIVE_THREAD_ID,
          role: "assistant",
          content: "",
          createdAt: "2026-08-09T08:30:00.000Z",
          attachments: [],
          runStatus: "running",
          runEventCount: 0,
        },
        run: {
          id: "run-next",
          threadId: ACTIVE_THREAD_ID,
          messageId: "message-active-user",
          assistantMessageId: "message-active-assistant-next",
          startedAt: "2026-08-09T08:30:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      // Only the new assistant message + run + thread activity; the existing
      // user message is NOT re-inserted.
      expect(await auditedEntries(store)).toEqual([
        "thread_messages:insert:message-active-assistant-next",
        "thread_runs:insert:run-next",
        "threads:update:thread-active",
      ]);
    });
  });

  it("rolls back a run, deleting its messages and run and recomputing activity", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      // Seed a second user message at a later time so rollback recomputes
      // lastActivityAt from the remaining message rather than the thread
      // createdAt.
      const seeded: AppStateSnapshot = {
        ...before,
        threadMessages: [
          ...(before.threadMessages ?? []),
          {
            id: "message-active-user-2",
            threadId: ACTIVE_THREAD_ID,
            role: "user",
            content: "second turn",
            createdAt: "2026-08-09T08:05:00.000Z",
            attachments: [],
          },
        ],
      };
      await store.saveAppStateSnapshot(seeded);
      await clearAudit(store);

      const value = command("thread:rollback-run", {
        threadId: ACTIVE_THREAD_ID,
        runId: "run-active",
        messageId: "message-active-user",
        assistantMessageId: "message-active-existing",
      });
      const after = reduce(seeded, value);
      await store.persistAppStateCommand(value, seeded, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threadRuns?.map((run) => run.id)).not.toContain("run-active");
      expect(loaded?.threadMessages?.map((message) => message.id)).not.toContain(
        "message-active-existing",
      );
      // lastActivityAt recomputed to the latest remaining message's createdAt.
      expect(threadById(loaded, ACTIVE_THREAD_ID)?.lastActivityAt).toBe("2026-08-09T08:05:00.000Z");
      expect(await auditedEntries(store)).toEqual([
        "thread_messages:delete:message-active-existing",
        "thread_messages:delete:message-active-user",
        "thread_runs:delete:run-active",
        "threads:update:thread-active",
      ]);
    });
  });

  it("records a thread action and bumps activity time in the same transaction", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const value = command("thread:record-action", {
        threadId: ACTIVE_THREAD_ID,
        action: {
          id: "action-1",
          threadId: ACTIVE_THREAD_ID,
          action: "compact",
          runtimeId: "kimi",
          completedAt: "2026-08-09T09:00:00.000Z",
        },
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threadActions?.map((action) => action.id)).toEqual(["action-1"]);
      expect(threadById(loaded, ACTIVE_THREAD_ID)?.lastActivityAt).toBe("2026-08-09T09:00:00.000Z");
      // The action insert and the activity-time update commit together; the
      // unrelated history thread's activity is untouched.
      expect(await auditedEntries(store)).toEqual([
        "thread_actions:insert:action-1",
        "threads:update:thread-active",
      ]);
    });
  });

  it("appends one message to a thread without rewriting unrelated history", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const existing = (before.threadMessages ?? []).filter(
        (message) => message.threadId === ACTIVE_THREAD_ID,
      );
      const value = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: [
          ...existing,
          {
            id: "message-active-appended",
            threadId: ACTIVE_THREAD_ID,
            role: "user",
            content: "appended",
            createdAt: "2026-08-09T08:10:00.000Z",
            attachments: [],
          },
        ],
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threadMessages?.map((message) => message.id)).toContain(
        "message-active-appended",
      );
      // Exactly one insert; the existing active-thread message and the 20
      // unrelated history messages produce zero writes.
      expect(await auditedEntries(store)).toEqual([
        "thread_messages:insert:message-active-appended",
      ]);
    });
  });

  it("updates one streamed message without touching siblings or thread metadata", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const existing = (before.threadMessages ?? []).filter(
        (message) => message.threadId === ACTIVE_THREAD_ID,
      );
      // Stream a new event into the running assistant message: higher event
      // count, still running, new content.
      const streamed = existing.map((message) =>
        message.id === "message-active-existing"
          ? { ...message, content: "partial answer", runEventCount: 6 }
          : message,
      );
      const value = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: streamed,
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(
        loaded?.threadMessages?.find((message) => message.id === "message-active-existing")
          ?.runEventCount,
      ).toBe(6);
      // Exactly one update; no thread row (the stream carried no thread patch).
      expect(await auditedEntries(store)).toEqual([
        "thread_messages:update:message-active-existing",
      ]);
    });
  });

  it("preserves the higher run event count against a regressing stream", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const existing = (before.threadMessages ?? []).filter(
        (message) => message.threadId === ACTIVE_THREAD_ID,
      );
      // An incoming message with a LOWER event count than stored (5 -> 3) must
      // not regress. The reducer keeps the existing row, so `after` carries the
      // existing (higher-count) message; persistence must not write a regression.
      const regressing = existing.map((message) =>
        message.id === "message-active-existing" ? { ...message, runEventCount: 3 } : message,
      );
      const value = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: regressing,
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(
        loaded?.threadMessages?.find((message) => message.id === "message-active-existing")
          ?.runEventCount,
      ).toBe(5);
      // No write at all: the reconciled row equals the stored row.
      expect(await auditedEntries(store)).toEqual([]);
    });
  });

  it("does not delete messages when a thread-content payload omits them", async () => {
    // thread-content:update merges by id; an empty messages array is not a
    // wipe. Explicit removal uses deleteMessageIds or thread:rollback-run.
    const seeded: AppStateSnapshot = {
      ...baseSnapshot(),
      threadRuns: [],
      threadMessages: [
        {
          id: "message-active-standalone",
          threadId: ACTIVE_THREAD_ID,
          role: "user",
          content: "standalone",
          createdAt: "2026-08-09T08:00:00.000Z",
          attachments: [],
        },
        ...(baseSnapshot().threadMessages ?? []).filter(
          (message) => message.threadId === HISTORY_THREAD_ID,
        ),
      ],
    };
    await withStore(seeded, async (store, before) => {
      const value = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: [],
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(
        loaded?.threadMessages?.some((message) => message.id === "message-active-standalone"),
      ).toBe(true);
      expect(await auditedEntries(store)).toEqual([]);
    });
  });

  it("updates thread metadata only without touching messages", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const value = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        thread: { title: "Renamed thread", pinned: true },
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      expect(threadById(loaded, ACTIVE_THREAD_ID)).toMatchObject({
        title: "Renamed thread",
        pinned: true,
      });
      expect(await auditedEntries(store)).toEqual(["threads:update:thread-active"]);
    });
  });

  it("sets and removes Thread Composer State on the owning thread only", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const set = command("thread-work:update", {
        threadId: ACTIVE_THREAD_ID,
        work: { queuedMessages: [] },
      });
      const afterSet = reduce(before, set);
      await store.persistAppStateCommand(set, before, afterSet);
      expect(await auditedEntries(store)).toEqual(["thread_work:insert:thread-active"]);

      await clearAudit(store);
      const remove = command("thread-work:update", {
        threadId: ACTIVE_THREAD_ID,
        work: null,
      });
      const afterRemove = reduce(afterSet, remove);
      await store.persistAppStateCommand(remove, afterSet, afterRemove);
      expect(await auditedEntries(store)).toEqual(["thread_work:delete:thread-active"]);
    });
  });

  it("keeps the changed-row count fixed regardless of unrelated history size", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      // Append one message.
      const existing = (before.threadMessages ?? []).filter(
        (message) => message.threadId === ACTIVE_THREAD_ID,
      );
      const append = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: [
          ...existing,
          {
            id: "message-active-appended",
            threadId: ACTIVE_THREAD_ID,
            role: "user",
            content: "appended",
            createdAt: "2026-08-09T08:10:00.000Z",
            attachments: [],
          },
        ],
      });
      const afterAppend = reduce(before, append);
      await store.persistAppStateCommand(append, before, afterAppend);
      const appendEntries = await auditedEntries(store);
      // Fixed: exactly one insert regardless of the 20+1 unrelated rows.
      expect(appendEntries).toEqual(["thread_messages:insert:message-active-appended"]);

      await clearAudit(store);
      // Stream one message.
      const streamed = (afterAppend.threadMessages ?? [])
        .filter((message) => message.threadId === ACTIVE_THREAD_ID)
        .map((message) =>
          message.id === "message-active-existing"
            ? { ...message, content: "more", runEventCount: 6 }
            : message,
        );
      const stream = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: streamed,
      });
      const afterStream = reduce(afterAppend, stream);
      await store.persistAppStateCommand(stream, afterAppend, afterStream);
      const streamEntries = await auditedEntries(store);
      // Fixed: exactly one update regardless of history size.
      expect(streamEntries).toEqual(["thread_messages:update:message-active-existing"]);
    });
  });

  it("rolls back the whole command and leaves the pre-command snapshot when persistence fails", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const existing = (before.threadMessages ?? []).filter(
        (message) => message.threadId === ACTIVE_THREAD_ID,
      );
      const value = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: [
          ...existing,
          {
            id: "message-active-appended",
            threadId: ACTIVE_THREAD_ID,
            role: "user",
            content: "appended",
            createdAt: "2026-08-09T08:10:00.000Z",
            attachments: [],
          },
        ],
      });
      const after = reduce(before, value);
      await store.run((client) =>
        client.run(
          `CREATE TEMP TRIGGER fail_message_insert
           BEFORE INSERT ON thread_messages
           BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
        ),
      );

      let message = "";
      try {
        await store.persistAppStateCommand(value, before, after);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain("injected failure");

      // The transaction rolled back: the appended message is absent and the
      // caller's pre-command snapshot remains authoritative.
      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threadMessages?.map((m) => m.id)).not.toContain("message-active-appended");
      expect(sortedThreadMessages(loaded, ACTIVE_THREAD_ID)).toEqual(
        sortedThreadMessages(before, ACTIVE_THREAD_ID),
      );
    });
  });

  it("round-trips the full Thread content through close and reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-content-reopen-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const store = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await store.open();
      const before = baseSnapshot();
      await store.saveAppStateSnapshot(before);

      const existing = (before.threadMessages ?? []).filter(
        (message) => message.threadId === ACTIVE_THREAD_ID,
      );
      const value = command("thread-content:update", {
        threadId: ACTIVE_THREAD_ID,
        messages: [
          ...existing,
          {
            id: "message-active-appended",
            threadId: ACTIVE_THREAD_ID,
            role: "user",
            content: "appended",
            createdAt: "2026-08-09T08:10:00.000Z",
            attachments: [],
          },
        ],
      });
      const after = reduce(before, value);
      await store.persistAppStateCommand(value, before, after);
      await store.close();

      const reopened = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await reopened.open();
      const loaded = await reopened.loadAppStateSnapshot();
      expect(sortedThreadMessages(loaded, ACTIVE_THREAD_ID)).toEqual(
        sortedThreadMessages(after, ACTIVE_THREAD_ID),
      );
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
