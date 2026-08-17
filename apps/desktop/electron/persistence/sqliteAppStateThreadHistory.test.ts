import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_STATE_SNAPSHOT_VERSION,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";

function baseHistorySnapshot(): AppStateSnapshot {
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
        id: "thread-a",
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "History thread",
        createdAt: "2026-08-09T08:00:00.000Z",
        lastActivityAt: "2026-08-09T09:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
    ],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: "workspace-a",
  };
}

describe("SQLite App State thread history", () => {
  it("downgrades interrupted pending and running state through the existing normalizer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = baseHistorySnapshot();
      snapshot.threadMessages = [
        {
          id: "message-assistant",
          threadId: "thread-a",
          role: "assistant",
          content: "",
          createdAt: "2026-08-09T08:02:00.000Z",
          runStatus: "running",
          attachments: [],
          parts: [
            {
              type: "plan_review",
              id: "plan-1",
              permissionId: "permission-1",
              content: "Step 1",
              status: "pending",
              options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
            },
            {
              type: "question",
              id: "question-1",
              questionId: "q-1",
              status: "pending",
              questions: [{ header: "Scope", question: "Everything?" }],
            },
            {
              type: "subagent_task",
              id: "task-1",
              runtimeId: "kimi",
              source: "agent",
              description: "Explore the codebase",
              background: false,
              status: "running",
              startedAt: 1_754_000_000_000,
            },
          ],
        },
      ];
      await store.saveAppStateSnapshot(snapshot);

      const loaded = await store.loadAppStateSnapshot();
      const message = loaded?.threadMessages?.[0];
      // Pending approvals/questions and running Subagent Tasks load as
      // interrupted instead of resuming as fake live state. The message-level
      // run flag round-trips untouched: the renderer owns that reconciliation,
      // exactly as with the JSON store.
      const parts = message && "parts" in message ? message.parts : undefined;
      expect(parts?.map((part) => [part.type, "status" in part ? part.status : undefined])).toEqual(
        [
          ["plan_review", "interrupted"],
          ["question", "interrupted"],
          ["subagent_task", "interrupted"],
        ],
      );
      expect(message?.runStatus).toBe("running");
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails the whole load when a stored message payload is malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = baseHistorySnapshot();
      snapshot.threadMessages = [
        {
          id: "message-user",
          threadId: "thread-a",
          role: "user",
          content: "Hello",
          createdAt: "2026-08-09T08:01:00.000Z",
          attachments: [],
        },
      ];
      await store.saveAppStateSnapshot(snapshot);
      await store.run((client) =>
        client.run(
          "UPDATE thread_messages SET payload = ? WHERE id = ?",
          "{malformed",
          "message-user",
        ),
      );

      expect(await store.loadAppStateSnapshot()).toBe(null);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails the whole load when a stored Thread Work draft is malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = baseHistorySnapshot();
      snapshot.threadWork = {
        "thread-a": {
          draft: { content: "Unsent", attachedSkillNames: [], attachments: [] },
          queuedMessages: [],
        },
      };
      await store.saveAppStateSnapshot(snapshot);
      await store.run((client) =>
        client.run("UPDATE thread_work SET draft = ? WHERE thread_id = ?", "[broken", "thread-a"),
      );

      expect(await store.loadAppStateSnapshot()).toBe(null);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails the whole load when a Run references a Message from another Thread", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = baseHistorySnapshot();
      snapshot.threads = [
        ...snapshot.threads!,
        {
          id: "thread-b",
          workspaceId: "workspace-a",
          projectId: "project-a",
          title: "Second thread",
          createdAt: "2026-08-09T08:10:00.000Z",
          lastActivityAt: "2026-08-09T08:10:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
      ];
      snapshot.threadMessages = [
        {
          id: "message-user",
          threadId: "thread-a",
          role: "user",
          content: "Hello",
          createdAt: "2026-08-09T08:01:00.000Z",
          attachments: [],
        },
      ];
      snapshot.threadRuns = [
        {
          id: "run-1",
          threadId: "thread-a",
          messageId: "message-user",
          startedAt: "2026-08-09T08:01:30.000Z",
          runtimeId: "kimi",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
      ];
      await store.saveAppStateSnapshot(snapshot);
      await store.run((client) =>
        client.run("UPDATE thread_runs SET thread_id = ? WHERE id = ?", "thread-b", "run-1"),
      );

      expect(await store.loadAppStateSnapshot()).toBe(null);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a save whose Promotion Intent does not match its Thread Draft", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = baseHistorySnapshot();
      snapshot.threadDrafts = [
        {
          id: "draft-a",
          threadId: "reserved-thread",
          workspaceId: "workspace-a",
          projectId: "project-a",
          content: "Draft",
          attachedSkillNames: [],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ];
      snapshot.threadPromotionIntents = [
        {
          draftId: "draft-a",
          threadId: "some-other-thread",
          workspaceId: "workspace-a",
          projectId: "project-a",
          title: "Mismatched",
          runId: "run-promotion",
          messageId: "message-promotion",
          message: "Draft",
          attachments: [],
          startedAt: "2026-08-09T08:06:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ];

      let saveRejected = false;
      try {
        await store.saveAppStateSnapshot(snapshot);
      } catch {
        saveRejected = true;
      }
      expect(saveRejected).toBe(true);

      // A Promotion Intent cannot reference a missing Draft at the database level.
      let insertRejected = false;
      try {
        await store.run((client) =>
          client.run(
            `INSERT INTO promotion_intents (
               draft_id, thread_id, workspace_id, project_id, title, run_id, message_id,
               message, attachments, started_at, runtime_id, runtime_mode, plan_mode
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            "missing-draft",
            "reserved-thread",
            "workspace-a",
            "project-a",
            "Orphan",
            "run-orphan",
            "message-orphan",
            "Orphan",
            "[]",
            "2026-08-09T08:06:00.000Z",
            "kimi",
            "approval-required",
            0,
          ),
        );
      } catch {
        insertRejected = true;
      }
      expect(insertRejected).toBe(true);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cleans up Messages, Runs, Actions, and Thread Work when the owning Thread is deleted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = baseHistorySnapshot();
      snapshot.threadMessages = [
        {
          id: "message-user",
          threadId: "thread-a",
          role: "user",
          content: "Hello",
          createdAt: "2026-08-09T08:01:00.000Z",
          attachments: [],
        },
      ];
      snapshot.threadRuns = [
        {
          id: "run-1",
          threadId: "thread-a",
          messageId: "message-user",
          startedAt: "2026-08-09T08:01:30.000Z",
          runtimeId: "kimi",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
      ];
      snapshot.threadActions = [
        {
          id: "action-1",
          threadId: "thread-a",
          action: "compact",
          runtimeId: "kimi",
          completedAt: "2026-08-09T08:05:00.000Z",
        },
      ];
      snapshot.threadWork = {
        "thread-a": { queuedMessages: [{ id: "queued-1", content: "Later" }] },
      };
      await store.saveAppStateSnapshot(snapshot);

      await store.run((client) => client.run("DELETE FROM threads WHERE id = ?", "thread-a"));

      const counts = await store.run((client) => ({
        messages: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_messages")
          ?.count,
        runs: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_runs")?.count,
        actions: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_actions")
          ?.count,
        work: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_work")?.count,
      }));
      expect(counts).toEqual({ messages: 0, runs: 0, actions: 0, work: 0 });
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips Thread Work drafts and stamps queued messages as requiring confirmation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const snapshot = baseHistorySnapshot();
      snapshot.threadWork = {
        "thread-a": {
          draft: {
            content: "Unsent composer text",
            composerState: '{"root":{"children":[{"text":"Unsent"}]}}',
            attachedSkillNames: ["code-review"],
            attachments: [
              {
                id: "attachment-3",
                kind: "file",
                name: "notes.txt",
                mimeType: "text/plain",
                size: 32,
                storageKey: "attachments/notes.txt",
              },
            ],
            localPathContexts: [{ path: "/tmp/draft.ts", basename: "draft.ts", kind: "file" }],
          },
          queuedMessages: [
            {
              id: "queued-1",
              content: "Auto-continuing work",
              attachments: [
                {
                  id: "attachment-4",
                  kind: "image",
                  name: "shot.png",
                  mimeType: "image/png",
                  size: 128,
                  storageKey: "attachments/shot.png",
                },
              ],
              localPathContexts: [
                { path: "/tmp/reference", basename: "reference", kind: "directory" },
              ],
            },
            { id: "queued-2", content: "Already confirmed", requiresConfirmation: true },
          ],
        },
      };

      const store = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await store.open();
      await store.saveAppStateSnapshot(snapshot);
      const loaded = await store.loadAppStateSnapshot();

      // Every persisted queued message requires explicit confirmation after a
      // restart, so recovered work never sends automatically.
      expect(loaded?.threadWork?.["thread-a"]?.queuedMessages).toEqual([
        {
          id: "queued-1",
          content: "Auto-continuing work",
          attachments: [
            {
              id: "attachment-4",
              kind: "image",
              name: "shot.png",
              mimeType: "image/png",
              size: 128,
              storageKey: "attachments/shot.png",
            },
          ],
          localPathContexts: [{ path: "/tmp/reference", basename: "reference", kind: "directory" }],
          requiresConfirmation: true,
        },
        { id: "queued-2", content: "Already confirmed", requiresConfirmation: true },
      ]);
      expect(loaded?.threadWork?.["thread-a"]?.draft).toEqual(
        snapshot.threadWork["thread-a"]!.draft,
      );
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips Runs, Thread Actions, Promotion Intents, and the Run Checklist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const snapshot = baseHistorySnapshot();
      snapshot.threads = [
        {
          ...snapshot.threads![0]!,
          runChecklist: {
            runId: "run-1",
            runtimeId: "kimi",
            outcome: "completed",
            expanded: true,
            entries: [
              { content: "Explore", status: "completed" },
              { content: "Implement", status: "in_progress" },
              { content: "Verify", status: "pending" },
            ],
          },
        },
      ];
      snapshot.threadMessages = [
        {
          id: "message-user",
          threadId: "thread-a",
          role: "user",
          content: "Run the checklist",
          createdAt: "2026-08-09T08:01:00.000Z",
          attachments: [],
        },
        {
          id: "message-assistant",
          threadId: "thread-a",
          role: "assistant",
          content: "Done",
          createdAt: "2026-08-09T08:02:00.000Z",
          attachments: [],
        },
        {
          id: "message-follow-up",
          threadId: "thread-a",
          role: "user",
          content: "Thanks",
          createdAt: "2026-08-09T08:04:00.000Z",
          attachments: [],
        },
      ];
      snapshot.threadRuns = [
        {
          id: "run-1",
          threadId: "thread-a",
          messageId: "message-user",
          assistantMessageId: "message-assistant",
          startedAt: "2026-08-09T08:01:30.000Z",
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
        {
          id: "run-2",
          threadId: "thread-a",
          messageId: "message-follow-up",
          startedAt: "2026-08-09T08:04:30.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: true,
        },
      ];
      snapshot.threadActions = [
        {
          id: "action-1",
          threadId: "thread-a",
          action: "compact",
          runtimeId: "kimi",
          completedAt: "2026-08-09T08:05:00.000Z",
        },
      ];
      snapshot.threadDrafts = [
        {
          id: "draft-a",
          threadId: "reserved-thread",
          workspaceId: "workspace-a",
          projectId: "project-a",
          content: "Draft to promote",
          attachedSkillNames: ["tdd"],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: true,
        },
      ];
      snapshot.threadPromotionIntents = [
        {
          draftId: "draft-a",
          threadId: "reserved-thread",
          workspaceId: "workspace-a",
          projectId: "project-a",
          title: "Promoted draft",
          runId: "run-promotion",
          messageId: "message-promotion",
          message: "Draft to promote",
          attachments: [
            {
              id: "attachment-2",
              kind: "file",
              name: "spec.md",
              mimeType: "text/markdown",
              size: 512,
              storageKey: "attachments/spec.md",
            },
          ],
          startedAt: "2026-08-09T08:06:00.000Z",
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "approval-required",
          planMode: true,
        },
      ];

      const first = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await first.open();
      await first.saveAppStateSnapshot(snapshot);
      await first.close();

      const second = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await second.open();
      expect(await second.loadAppStateSnapshot()).toEqual(snapshot);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips Thread messages with activity, attachments, and changed files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const snapshot = baseHistorySnapshot();
      snapshot.threadMessages = [
        {
          id: "message-user",
          threadId: "thread-a",
          role: "user",
          content: "Refactor the persistence layer",
          createdAt: "2026-08-09T08:01:00.000Z",
          timestamp: "08:01",
          attachments: [
            {
              id: "attachment-1",
              kind: "image",
              name: "diagram.png",
              mimeType: "image/png",
              size: 2048,
              storageKey: "attachments/diagram.png",
              sha256: "a".repeat(64),
              width: 640,
              height: 480,
            },
          ],
          localPathContexts: [
            { path: "/tmp/context.ts", basename: "context.ts", kind: "file" },
            { path: "/tmp/reference", basename: "reference", kind: "directory" },
          ],
        },
        {
          id: "message-assistant",
          threadId: "thread-a",
          role: "assistant",
          content: "Done",
          createdAt: "2026-08-09T08:02:00.000Z",
          runStatus: "completed",
          runFinishedAt: 1_754_000_000_000,
          runEventCount: 7,
          duration: "12s",
          attachments: [],
          parts: [
            { type: "reasoning", id: "reasoning-1", content: "Planning", status: "completed" },
            {
              type: "shell",
              id: "shell-1",
              command: "bun test",
              output: "pass",
              status: "completed",
              exitCode: 0,
            },
            {
              type: "question",
              id: "question-1",
              questionId: "q-1",
              status: "answered",
              questions: [{ header: "Scope", question: "Everything?" }],
              answers: [{ questionIndex: 0, labels: ["Yes"], customText: "all of it" }],
            },
          ],
        },
        {
          id: "message-changed-files",
          threadId: "thread-a",
          role: "assistant",
          type: "changed_files",
          content: "",
          createdAt: "2026-08-09T08:03:00.000Z",
          attachments: [],
          changedFiles: [
            {
              path: "src/index.ts",
              additions: 10,
              deletions: 2,
              binary: false,
              untracked: false,
              fileType: "other",
            },
          ],
          snapshot: {
            baseRevision: "abc123",
            capturedAt: "2026-08-09T08:03:00.000Z",
            patch: "diff --git a/src/index.ts b/src/index.ts",
            truncated: false,
          },
        },
      ];

      const first = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await first.open();
      await first.saveAppStateSnapshot(snapshot);
      await first.close();

      const second = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await second.open();
      const loaded = await second.loadAppStateSnapshot();
      expect(loaded).toEqual(snapshot);
      expect(await second.loadAppStateSnapshot()).toEqual(loaded);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips one complete Snapshot with identity, history, and settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const snapshot = baseHistorySnapshot();
      snapshot.threads = [
        {
          ...snapshot.threads![0]!,
          runChecklist: {
            runId: "run-1",
            runtimeId: "kimi",
            outcome: "failed",
            expanded: false,
            entries: [{ content: "Only step", status: "completed" }],
          },
        },
      ];
      snapshot.threadMessages = [
        {
          id: "message-user",
          threadId: "thread-a",
          role: "user",
          content: "Complete snapshot",
          createdAt: "2026-08-09T08:01:00.000Z",
          attachments: [],
        },
      ];
      snapshot.threadRuns = [
        {
          id: "run-1",
          threadId: "thread-a",
          messageId: "message-user",
          startedAt: "2026-08-09T08:01:30.000Z",
          runtimeId: "kimi",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
      ];
      snapshot.threadActions = [
        {
          id: "action-1",
          threadId: "thread-a",
          action: "compact",
          runtimeId: "kimi",
          completedAt: "2026-08-09T08:05:00.000Z",
        },
      ];
      snapshot.threadDrafts = [
        {
          id: "draft-a",
          threadId: "reserved-thread",
          workspaceId: "workspace-a",
          projectId: "project-a",
          content: "Draft",
          attachedSkillNames: [],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ];
      snapshot.threadPromotionIntents = [
        {
          draftId: "draft-a",
          threadId: "reserved-thread",
          workspaceId: "workspace-a",
          projectId: "project-a",
          title: "Promoted draft",
          runId: "run-promotion",
          messageId: "message-promotion",
          message: "Draft",
          attachments: [],
          startedAt: "2026-08-09T08:06:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ];
      snapshot.threadWork = {
        "thread-a": {
          draft: { content: "Unsent", attachedSkillNames: [], attachments: [] },
          queuedMessages: [{ id: "queued-1", content: "Later", requiresConfirmation: true }],
        },
      };
      snapshot.settings = {
        autoDetectRuntimes: false,
        theme: "light",
        fontSize: 18,
        defaultEditorId: "",
        enhancedTerminalCompletion: false,
        terminalPanelHeight: 400,
        runtimeEnabledById: { kimi: true },
        runtimeDefaultModelById: { kimi: "kimi-k2.5" },
        customFontFamily: "",
      };
      snapshot.lastThreadIdByWorkspace = { "workspace-a": "thread-a" };

      const first = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await first.open();
      await first.saveAppStateSnapshot(snapshot);
      await first.close();

      const second = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await second.open();
      expect(await second.loadAppStateSnapshot()).toEqual(snapshot);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reassembles collections in a deterministic order regardless of stored array order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const snapshot = baseHistorySnapshot();
      snapshot.threads = [
        ...snapshot.threads!,
        {
          id: "thread-b",
          workspaceId: "workspace-a",
          projectId: "project-a",
          title: "Second thread",
          createdAt: "2026-08-09T08:10:00.000Z",
          lastActivityAt: "2026-08-09T08:10:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "auto-accept-edits",
          planMode: false,
        },
      ];
      // Interleaved across threads and not in (thread, created_at) order.
      snapshot.threadMessages = [
        {
          id: "message-b-1",
          threadId: "thread-b",
          role: "user",
          content: "B first",
          createdAt: "2026-08-09T08:11:00.000Z",
          attachments: [],
        },
        {
          id: "message-a-2",
          threadId: "thread-a",
          role: "user",
          content: "A second",
          createdAt: "2026-08-09T08:02:00.000Z",
          attachments: [],
        },
        {
          id: "message-a-1",
          threadId: "thread-a",
          role: "user",
          content: "A first",
          createdAt: "2026-08-09T08:01:00.000Z",
          attachments: [],
        },
      ];

      const first = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await first.open();
      await first.saveAppStateSnapshot(snapshot);
      await first.close();

      const second = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await second.open();
      const loaded = await second.loadAppStateSnapshot();
      expect(loaded?.threadMessages?.map((message) => message.id)).toEqual([
        "message-a-1",
        "message-a-2",
        "message-b-1",
      ]);
      // Repeated reads are stable.
      expect(await second.loadAppStateSnapshot()).toEqual(loaded);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an incomplete Snapshot instead of wiping stored history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-history-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = baseHistorySnapshot();
      snapshot.threadMessages = [
        {
          id: "message-user",
          threadId: "thread-a",
          role: "user",
          content: "Keep me",
          createdAt: "2026-08-09T08:01:00.000Z",
          attachments: [],
        },
      ];
      await store.saveAppStateSnapshot(snapshot);

      const incomplete: AppStateSnapshot = { ...snapshot };
      delete incomplete.threadMessages;
      let rejected = false;
      try {
        await store.saveAppStateSnapshot(incomplete);
      } catch {
        rejected = true;
      }

      expect(rejected).toBe(true);
      expect((await store.loadAppStateSnapshot())?.threadMessages).toEqual(snapshot.threadMessages);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
