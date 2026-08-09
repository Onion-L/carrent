import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  APP_STATE_SNAPSHOT_VERSION,
  normalizeAppStateSnapshotForMemory,
  type AppStateSnapshot,
  type AssociationThreadDraftRecord,
} from "../../src/shared/workspacePersistence";
import { appStateCommandReducers } from "../workspace/appStateCommands";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore, type SqliteAppStateStore } from "./sqliteAppStateStore";

// A snapshot with one association and the history the strict persisted-snapshot
// normalizer requires. Drafts, messages, and intents start empty so each test
// drives the lifecycle from a known point.
function baseSnapshot(): AppStateSnapshot {
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
    threads: [],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    settings: {
      autoDetectRuntimes: true,
      theme: "system",
      fontSize: 15,
      enhancedTerminalCompletion: true,
      terminalPanelHeight: 320,
      runtimeEnabledById: {},
      runtimeDefaultModelById: {},
    },
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: "workspace-a",
  };
}

function draftRecord(): AssociationThreadDraftRecord {
  return {
    id: "draft-a",
    threadId: "thread-promoted",
    workspaceId: "workspace-a",
    projectId: "project-a",
    content: "first turn",
    attachedSkillNames: [],
    attachments: [],
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
  };
}

// The reducer resolves `thread-draft:open` to get-or-create; here it always
// creates because the base snapshot has no drafts.
function openDraftPayload(draft: AssociationThreadDraftRecord) {
  return {
    workspaceId: draft.workspaceId,
    projectId: draft.projectId,
    draft,
  };
}

function promotionPayload(draft: AssociationThreadDraftRecord, startedAt = "2026-08-09T09:00:00.000Z") {
  return {
    draftId: draft.id,
    threadId: draft.threadId,
    thread: {
      id: draft.threadId,
      workspaceId: draft.workspaceId,
      projectId: draft.projectId,
      title: "First turn",
      createdAt: startedAt,
      lastActivityAt: startedAt,
      runtimeId: "kimi",
      runtimeMode: "full-access",
      planMode: false,
    },
    message: {
      id: "message-user",
      threadId: draft.threadId,
      role: "user",
      content: draft.content,
      createdAt: startedAt,
      attachments: [
        {
          id: "attachment-1",
          kind: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          size: 12,
          storageKey: "attachments/notes.txt",
          sha256: "a".repeat(64),
        },
      ],
    },
    assistantMessage: {
      id: "message-assistant",
      threadId: draft.threadId,
      role: "assistant",
      content: "",
      createdAt: startedAt,
      attachments: [],
      runStatus: "running",
      runEventCount: 0,
    },
    run: {
      id: "run-1",
      threadId: draft.threadId,
      messageId: "message-user",
      assistantMessageId: "message-assistant",
      startedAt,
      runtimeId: "kimi",
      runtimeMode: "full-access",
      planMode: false,
    },
  };
}

function command(type: string, payload?: unknown): AppStateCommand {
  return { commandId: `command:${type}:${Math.random().toString(36).slice(2)}`, type, payload };
}

// Order-independent comparison for messages that share a `createdAt`: the
// repository reads `thread_messages` ordered by `(thread_id, created_at, id)`,
// while the in-memory `after` keeps the reducer's append order. Comparing the
// sorted sets proves both sides carry the same rows without coupling the test
// to the database's tie-break ordering.
function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function reduce(before: AppStateSnapshot, value: AppStateCommand): AppStateSnapshot {
  const produced = appStateCommandReducers[value.type]?.(before, value.payload);
  if (!produced) throw new Error(`Fixture command was rejected: ${value.type}`);
  const next = "snapshot" in produced ? produced.snapshot : produced;
  const normalized = normalizeAppStateSnapshotForMemory(next);
  if (!normalized) throw new Error(`Fixture command produced invalid state: ${value.type}`);
  return normalized;
}

// Reduce and return the full reducer result (data + snapshot) so tests can
// inspect the accepted command's data.
function reduceResult(before: AppStateSnapshot, value: AppStateCommand) {
  const produced = appStateCommandReducers[value.type]?.(before, value.payload);
  if (!produced) throw new Error(`Fixture command was rejected: ${value.type}`);
  const next = "snapshot" in produced ? produced.snapshot : produced;
  const normalized = normalizeAppStateSnapshotForMemory(next);
  if (!normalized) throw new Error(`Fixture command produced invalid state: ${value.type}`);
  return {
    snapshot: normalized,
    data: "snapshot" in produced ? produced.data : undefined,
    noOp: next === before,
  };
}

// A draft-focused write audit: triggers on the lifecycle tables so each test
// can prove only the owning Draft / Thread-owned rows were touched.
const AUDIT_TABLES: Array<[string, (row: "OLD" | "NEW") => string]> = [
  ["thread_drafts", (row) => `${row}.id`],
  ["threads", (row) => `${row}.id`],
  ["thread_messages", (row) => `${row}.id`],
  ["thread_runs", (row) => `${row}.id`],
  ["promotion_intents", (row) => `${row}.draft_id`],
  ["thread_work", (row) => `${row}.thread_id`],
];

async function installWriteAudit(store: SqliteAppStateStore): Promise<void> {
  await store.run((client) => {
    client.run("CREATE TEMP TABLE draft_write_audit (entry TEXT NOT NULL)");
    for (const [table, key] of AUDIT_TABLES) {
      for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
        const row = operation === "DELETE" ? "OLD" : "NEW";
        client.run(
          `CREATE TEMP TRIGGER draft_audit_${table}_${operation.toLowerCase()}
           AFTER ${operation} ON ${table}
           BEGIN
             INSERT INTO draft_write_audit (entry)
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
      .all<{ entry: string }>("SELECT entry FROM draft_write_audit ORDER BY entry")
      .map((row) => row.entry),
  );
}

async function clearAudit(store: SqliteAppStateStore): Promise<void> {
  await store.run((client) => client.run("DELETE FROM draft_write_audit"));
}

async function withStore(
  before: AppStateSnapshot,
  run: (store: SqliteAppStateStore, before: AppStateSnapshot) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-draft-"));
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

// A base snapshot that already has the draft row, for update/discard/promote.
function snapshotWithDraft(): AppStateSnapshot {
  const snapshot = baseSnapshot();
  snapshot.threadDrafts = [draftRecord()];
  return snapshot;
}

describe("SQLite App State Thread Draft lifecycle persistence", () => {
  it("persists a genuine draft open as one draft row", async () => {
    await withStore(baseSnapshot(), async (store, before) => {
      const draft = draftRecord();
      const value = command("thread-draft:open", openDraftPayload(draft));
      const after = reduce(before, value);

      await store.persistAppStateCommand(value, before, after);

      expect(await store.loadAppStateSnapshot()).toEqual(after);
      expect(await auditedEntries(store)).toEqual(["thread_drafts:insert:draft-a"]);
    });
  });

  it("updates only the content columns of one draft", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const value = command("thread-draft:update", {
        draftId: "draft-a",
        draft: {
          content: "edited turn",
          composerState: '{"root":{}}',
          attachedSkillNames: ["tdd"],
          attachments: [],
        },
      });
      const after = reduce(before, value);

      await store.persistAppStateCommand(value, before, after);

      expect(await store.loadAppStateSnapshot()).toEqual(after);
      expect(await auditedEntries(store)).toEqual(["thread_drafts:update:draft-a"]);
    });
  });

  it("updates only the runtime config columns of one draft", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const value = command("thread-draft:update-config", {
        draftId: "draft-a",
        config: {
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "full-access",
          planMode: true,
        },
      });
      const after = reduce(before, value);

      await store.persistAppStateCommand(value, before, after);

      expect(await store.loadAppStateSnapshot()).toEqual(after);
      expect(await auditedEntries(store)).toEqual(["thread_drafts:update:draft-a"]);
    });
  });

  it("discards a draft and its uncommitted promotion intent together", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      // Seed an uncommitted promotion intent directly so discard must remove it.
      await store.run((client) =>
        client.run(
          `INSERT INTO promotion_intents (
             draft_id, thread_id, workspace_id, project_id, title, run_id, message_id,
             message, attachments, started_at, runtime_id, runtime_mode, plan_mode
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          "draft-a",
          "thread-promoted",
          "workspace-a",
          "project-a",
          "First turn",
          "run-1",
          "message-user",
          "first turn",
          "[]",
          "2026-08-09T09:00:00.000Z",
          "kimi",
          "full-access",
          0,
        ),
      );
      await clearAudit(store);

      const value = command("thread-draft:discard", { draftId: "draft-a" });
      const after = reduce(before, value);

      await store.persistAppStateCommand(value, before, after);

      expect(await store.loadAppStateSnapshot()).toEqual(after);
      expect(await auditedEntries(store)).toEqual([
        "promotion_intents:delete:draft-a",
        "thread_drafts:delete:draft-a",
      ]);
      // No thread-owned rows exist for this association, so nothing else moved.
    });
  });

  it("promotes a draft atomically into Thread, messages, Run, and removes Draft and Intent", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const draft = draftRecord();
      const value = command("thread-draft:promote", promotionPayload(draft));
      const after = reduce(before, value);

      await store.persistAppStateCommand(value, before, after);

      const loaded = await store.loadAppStateSnapshot();
      // The user message and assistant placeholder share `startedAt`, so the
      // repository reads them back ordered by `(created_at, id)` while the
      // in-memory `after` keeps the reducer's append order. Compare the entity
      // sets by id rather than asserting whole-snapshot equality, then verify
      // each row round-trips with its attachment metadata intact.
      expect(loaded?.threads ?? []).toEqual(after.threads);
      expect(loaded?.threadDrafts).toEqual([]);
      expect([...(loaded?.threadMessages ?? [])].sort(byId)).toEqual(
        [...(after.threadMessages ?? [])].sort(byId),
      );
      expect(loaded?.threadRuns ?? []).toEqual(after.threadRuns);
      // The promoted Thread uses the Draft's reserved id + association + the
      // send-time runtime config, exactly as the reducer built it.
      expect(loaded?.threads?.map((thread) => thread.id)).toEqual(["thread-promoted"]);
      expect(loaded?.threadRuns?.map((run) => run.id)).toEqual(["run-1"]);
      // Attachment metadata round-trips through the payload column.
      const userMessage = loaded?.threadMessages?.find((message) => message.id === "message-user");
      expect(userMessage?.attachments).toEqual([
        {
          id: "attachment-1",
          kind: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          size: 12,
          storageKey: "attachments/notes.txt",
          sha256: "a".repeat(64),
        },
      ]);
      expect(await auditedEntries(store)).toEqual([
        "thread_drafts:delete:draft-a",
        "thread_messages:insert:message-assistant",
        "thread_messages:insert:message-user",
        "thread_runs:insert:run-1",
        "threads:insert:thread-promoted",
      ]);
    });
  });

  it("resolves a competing promotion to the existing Thread without duplicates", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const draft = draftRecord();
      const promote = command("thread-draft:promote", promotionPayload(draft));
      const promoted = reduce(before, promote);
      await store.persistAppStateCommand(promote, before, promoted);
      await clearAudit(store);

      // A second client wins the race in the reducer: created:false, no-op.
      const replay = reduceResult(promoted, command("thread-draft:promote", promotionPayload(draft)));
      expect(replay.noOp).toBe(true);
      expect(replay.data).toMatchObject({ created: false, thread: { id: "thread-promoted" } });

      // DB-level idempotency: persisting the same (before-with-draft,
      // after-with-thread) transition again must not duplicate any rows. The
      // competing-promotion guard sees the existing Thread and removes the
      // draft/intent without inserting again.
      const competingBefore = baseSnapshot();
      competingBefore.threadDrafts = [draftRecord()];
      const competingAfter = reduce(competingBefore, command("thread-draft:promote", promotionPayload(draft)));
      await store.persistAppStateCommand(
        command("thread-draft:promote", promotionPayload(draft)),
        competingBefore,
        competingAfter,
      );

      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threads?.filter((thread) => thread.id === "thread-promoted")).toHaveLength(1);
      expect(loaded?.threadMessages).toHaveLength(2);
      expect(loaded?.threadRuns).toHaveLength(1);
      // No duplicate inserts after the guard short-circuited creation.
      expect(await auditedEntries(store)).toEqual([]);
    });
  });

  it("rolls back a promotion, deleting Thread-owned rows and restoring the Draft", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const draft = draftRecord();
      const promote = command("thread-draft:promote", promotionPayload(draft));
      const promoted = reduce(before, promote);
      await store.persistAppStateCommand(promote, before, promoted);

      // Simulate a Thread Composer State entry for the promoted Thread so the
      // rollback's cascade on thread_work is observable.
      await store.run((client) =>
        client.run(
          `INSERT INTO thread_work (thread_id, queued_messages) VALUES (?, ?)`,
          "thread-promoted",
          "[]",
        ),
      );
      await clearAudit(store);

      const rollback = command("thread-draft:rollback-promotion", { draft: draftRecord() });
      const rolledBack = reduce(promoted, rollback);
      await store.persistAppStateCommand(rollback, promoted, rolledBack);

      const loaded = await store.loadAppStateSnapshot();
      expect(loaded).toEqual(rolledBack);
      expect(loaded?.threads).toEqual([]);
      expect(loaded?.threadMessages).toEqual([]);
      expect(loaded?.threadRuns).toEqual([]);
      expect(loaded?.threadDrafts?.map((item) => item.id)).toEqual(["draft-a"]);

      // Thread-owned rows and the Thread Composer State are gone, the draft is
      // back. promotion_intents had no row to delete here.
      const intents = await store.run((client) =>
        client.all<{ draft_id: string }>("SELECT draft_id FROM promotion_intents"),
      );
      expect(intents).toEqual([]);
      const work = await store.run((client) =>
        client.all<{ thread_id: string }>("SELECT thread_id FROM thread_work"),
      );
      expect(work).toEqual([]);
      expect(await auditedEntries(store)).toEqual([
        "thread_drafts:insert:draft-a",
        "thread_messages:delete:message-assistant",
        "thread_messages:delete:message-user",
        "thread_runs:delete:run-1",
        "thread_work:delete:thread-promoted",
        "threads:delete:thread-promoted",
      ]);
    });
  });

  it("treats a repeated rollback as a reducer no-op that persists nothing", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const draft = draftRecord();
      const promote = command("thread-draft:promote", promotionPayload(draft));
      const promoted = reduce(before, promote);
      await store.persistAppStateCommand(promote, before, promoted);

      const rollback = command("thread-draft:rollback-promotion", { draft: draftRecord() });
      const rolledBack = reduce(promoted, rollback);
      await store.persistAppStateCommand(rollback, promoted, rolledBack);
      await clearAudit(store);

      // The draft is already restored, so the reducer returns the same snapshot
      // reference and the authority never persists this command.
      const again = reduceResult(rolledBack, command("thread-draft:rollback-promotion", { draft: draftRecord() }));
      expect(again.noOp).toBe(true);
      expect(await auditedEntries(store)).toEqual([]);
    });
  });

  it("survives close and reopen after promote and after rollback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-draft-reopen-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const store = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await store.open();
      const before = snapshotWithDraft();
      await store.saveAppStateSnapshot(before);

      const draft = draftRecord();
      const promote = command("thread-draft:promote", promotionPayload(draft));
      const promoted = reduce(before, promote);
      await store.persistAppStateCommand(promote, before, promoted);
      await store.close();

      // Reopen after promote: the Thread/messages/run persist, the draft is gone.
      const reopened = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await reopened.open();
      const afterPromote = await reopened.loadAppStateSnapshot();
      expect(afterPromote?.threads?.map((thread) => thread.id)).toEqual(["thread-promoted"]);
      expect(afterPromote?.threadDrafts).toEqual([]);

      const rollback = command("thread-draft:rollback-promotion", { draft: draftRecord() });
      const rolledBack = reduce(promoted, rollback);
      await reopened.persistAppStateCommand(rollback, promoted, rolledBack);
      await reopened.close();

      // Reopen after rollback: the draft is back and the Thread-owned rows are gone.
      const final = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await final.open();
      const afterRollback = await final.loadAppStateSnapshot();
      expect(afterRollback?.threadDrafts?.map((item) => item.id)).toEqual(["draft-a"]);
      expect(afterRollback?.threads).toEqual([]);
      expect(afterRollback?.threadMessages).toEqual([]);
      expect(afterRollback?.threadRuns).toEqual([]);
      await final.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back the whole promote transaction when persistence fails, leaving a retryable draft", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const draft = draftRecord();
      const promote = command("thread-draft:promote", promotionPayload(draft));
      const after = reduce(before, promote);
      await store.run((client) =>
        client.run(
          `CREATE TEMP TRIGGER fail_thread_insert
           BEFORE INSERT ON threads
           BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
        ),
      );

      let message = "";
      try {
        await store.persistAppStateCommand(promote, before, after);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain("injected failure");

      // The transaction rolled back: the draft remains (retryable) and no
      // Thread-owned rows were committed.
      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threadDrafts?.map((item) => item.id)).toEqual(["draft-a"]);
      expect(loaded?.threads).toEqual([]);
      expect(loaded?.threadMessages).toEqual([]);
      expect(loaded?.threadRuns).toEqual([]);
      const intents = await store.run((client) =>
        client.all<{ draft_id: string }>("SELECT draft_id FROM promotion_intents"),
      );
      expect(intents).toEqual([]);
    });
  });

  it("rolls back the whole update transaction when a constraint fails", async () => {
    await withStore(snapshotWithDraft(), async (store, before) => {
      const value = command("thread-draft:update-config", {
        draftId: "draft-a",
        config: {
          runtimeId: "kimi",
          runtimeMode: "full-access",
          planMode: false,
        },
      });
      const after = reduce(before, value);
      // Force a CHECK failure on the runtime_mode update by rejecting every
      // thread_drafts update mid-transaction.
      await store.run((client) =>
        client.run(
          `CREATE TEMP TRIGGER fail_draft_update
           BEFORE UPDATE ON thread_drafts
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

      // State unchanged: the draft still has its original config.
      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threadDrafts?.[0]?.runtimeMode).toBe("approval-required");
      expect(loaded).toEqual(before);
    });
  });
});
