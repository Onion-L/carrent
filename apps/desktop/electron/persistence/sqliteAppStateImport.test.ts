import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { initializeSqliteAppState } from "./sqliteAppStateImport";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";
import { readProviderSessions } from "./providerSessionRepository";

const COMPLETED_AT = "2026-08-09T10:00:00.000Z";

function completeSnapshot(messageBytes = 32): AppStateSnapshot {
  const attachment = {
    id: "attachment-1",
    kind: "file" as const,
    name: "migration-notes.txt",
    mimeType: "text/plain",
    size: 128,
    storageKey: "attachments/attachment-1/migration-notes.txt",
  };
  return {
    version: 1,
    workspaces: [{ id: "workspace-1", name: "Migration", order: 0 }],
    projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/work/carrent" }],
    associations: [
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "auto-accept-edits",
      },
    ],
    threads: [
      {
        id: "thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "Import JSON",
        createdAt: "2026-08-09T08:00:00.000Z",
        lastActivityAt: "2026-08-09T09:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
        runChecklist: {
          runId: "run-1",
          runtimeId: "kimi",
          outcome: "completed",
          expanded: true,
          entries: [{ content: "Import", status: "completed" }],
        },
      },
    ],
    threadDrafts: [
      {
        id: "draft-1",
        threadId: "reserved-thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        content: "Recover this draft",
        attachedSkillNames: ["tdd"],
        attachments: [attachment],
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: true,
      },
    ],
    threadMessages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "x".repeat(messageBytes),
        createdAt: "2026-08-09T08:01:00.000Z",
        attachments: [attachment],
      },
    ],
    threadRuns: [
      {
        id: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        startedAt: "2026-08-09T08:01:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
    ],
    threadActions: [
      {
        id: "action-1",
        threadId: "thread-1",
        action: "compact",
        runtimeId: "kimi",
        completedAt: "2026-08-09T08:30:00.000Z",
      },
    ],
    threadPromotionIntents: [
      {
        draftId: "draft-1",
        threadId: "reserved-thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "Promoted draft",
        runId: "promotion-run-1",
        messageId: "promotion-message-1",
        message: "Recover this draft",
        attachments: [attachment],
        startedAt: "2026-08-09T09:01:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: true,
      },
    ],
    threadWork: {
      "thread-1": {
        draft: { content: "Unsent", attachedSkillNames: [], attachments: [attachment] },
        queuedMessages: [
          {
            id: "queued-1",
            content: "Run after restart",
            attachments: [attachment],
            requiresConfirmation: true,
          },
        ],
      },
    },
    settings: {
      autoDetectRuntimes: false,
      theme: "dark",
      fontSize: 16,
      enhancedTerminalCompletion: true,
      terminalPanelHeight: 420,
      runtimeEnabledById: { kimi: true },
      runtimeDefaultModelById: { kimi: "kimi-k2.5" },
    },
    lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
    activeWorkspaceId: "workspace-1",
  };
}

describe("initializeSqliteAppState", () => {
  it("imports a complete 10 MB JSON App State and Runtime Sessions exactly once", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const snapshot = completeSnapshot(10 * 1024 * 1024);
    const appStatePath = join(baseDir, "app-state.json");
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(appStatePath, JSON.stringify(snapshot), "utf-8");
      await writeFile(
        join(baseDir, "provider-sessions.json"),
        JSON.stringify({ version: 1, sessions: { "kimi:thread-1": "session-1" } }),
        "utf-8",
      );
      await sqlite.open();

      const result = await initializeSqliteAppState(sqlite, baseDir, {
        appVersion: "0.1.0",
        now: () => COMPLETED_AT,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready App State.");
      expect(result.source).toBe("json");
      expect(result.snapshot).toEqual(snapshot);
      expect(await sqlite.loadAppStateSnapshot()).toEqual(snapshot);
      expect(await sqlite.run((client) => readProviderSessions(client))).toEqual({
        "kimi:thread-1": "session-1",
      });
      expect(
        await sqlite.run((client) =>
          client.get<{ value: string }>(
            "SELECT value FROM app_metadata WHERE key = ?",
            "json-import-v1",
          ),
        ),
      ).toEqual({ value: JSON.stringify({ source: "json", completedAt: COMPLETED_AT }) });
      expect((await readdir(baseDir)).some((name) => name.startsWith("app-state.recovery-"))).toBe(
        true,
      );
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("uses SQLite when the committed marker exists and ignores a remaining JSON source", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const snapshot = completeSnapshot(10 * 1024 * 1024);
    const appStatePath = join(baseDir, "app-state.json");
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(appStatePath, JSON.stringify(snapshot), "utf-8");
      await sqlite.open();
      expect(
        (await initializeSqliteAppState(sqlite, baseDir, { now: () => COMPLETED_AT })).status,
      ).toBe("ready");

      await writeFile(appStatePath, "{malformed legacy source", "utf-8");
      const restarted = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => "2026-08-09T11:00:00.000Z",
      });

      expect(restarted.status).toBe("ready");
      if (restarted.status !== "ready") throw new Error("Expected ready App State.");
      expect(restarted.source).toBe("sqlite");
      expect(restarted.snapshot).toEqual(snapshot);
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  for (const [name, payload, expectedStage] of [
    ["malformed", "{partial", "parse"],
    ["invalid", JSON.stringify({ version: 1, workspaces: [] }), "validate"],
  ] as const) {
    it(`requires recovery for ${name} App State without creating authority`, async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
      const appStatePath = join(baseDir, "app-state.json");
      const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      try {
        await writeFile(appStatePath, payload, "utf-8");
        await sqlite.open();

        const result = await initializeSqliteAppState(sqlite, baseDir, {
          appVersion: "0.1.0",
          now: () => COMPLETED_AT,
        });

        expect(result.status).toBe("recovery-required");
        if (result.status !== "recovery-required") throw new Error("Expected recovery.");
        expect(result.diagnostics[0]?.stage).toBe(expectedStage);
        expect(
          await sqlite.run((client) =>
            client.get("SELECT value FROM app_metadata WHERE key = ?", "json-import-v1"),
          ),
        ).toBe(null);
        expect(
          (await readdir(baseDir)).some((entry) => entry.startsWith("app-state.recovery-")),
        ).toBe(false);
      } finally {
        await sqlite.close();
        await rm(baseDir, { recursive: true, force: true });
      }
    });
  }

  it("isolates invalid Runtime Session mappings while importing valid mappings", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(join(baseDir, "app-state.json"), JSON.stringify(completeSnapshot()), "utf-8");
      await writeFile(
        join(baseDir, "provider-sessions.json"),
        JSON.stringify({
          version: 1,
          sessions: {
            "kimi:thread-1": "session-valid",
            "kimi:thread-empty": "",
            "kimi:/legacy/project:thread-1": "session-legacy",
            "kimi:thread-number": 42,
            "codex:thread-1": "session-wrong-runtime",
          },
        }),
        "utf-8",
      );
      await sqlite.open();

      const result = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => COMPLETED_AT,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready App State.");
      expect(result.providerSessions).toEqual({ "kimi:thread-1": "session-valid" });
      expect(result.diagnostics.length).toBe(4);
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("quarantines malformed Runtime Session JSON without blocking App State import", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(join(baseDir, "app-state.json"), JSON.stringify(completeSnapshot()), "utf-8");
      await writeFile(join(baseDir, "provider-sessions.json"), "{private malformed data", "utf-8");
      await sqlite.open();

      const result = await initializeSqliteAppState(sqlite, baseDir, { now: () => COMPLETED_AT });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready App State.");
      expect(result.providerSessions).toEqual({});
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).not.toContain("private malformed data");
      expect(
        (await readdir(baseDir)).some((entry) => entry.startsWith("provider-sessions.corrupt-")),
      ).toBe(true);
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("rolls back an interrupted import and retries it without merging or duplication", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const snapshot = completeSnapshot(10 * 1024 * 1024);
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(join(baseDir, "app-state.json"), JSON.stringify(snapshot), "utf-8");
      await writeFile(
        join(baseDir, "provider-sessions.json"),
        JSON.stringify({ version: 1, sessions: { "kimi:thread-1": "session-1" } }),
        "utf-8",
      );
      await sqlite.open();
      let interrupted: unknown;
      try {
        await initializeSqliteAppState(sqlite, baseDir, {
          now: () => COMPLETED_AT,
          beforeCommit: () => {
            throw new Error("simulated interruption");
          },
        });
      } catch (error) {
        interrupted = error;
      }

      expect(interrupted instanceof Error).toBe(true);
      expect(
        await sqlite.run((client) => ({
          marker: client.get("SELECT value FROM app_metadata WHERE key = ?", "json-import-v1"),
          workspaces: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM workspaces")
            ?.count,
          sessions: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM provider_sessions")
            ?.count,
        })),
      ).toEqual({ marker: null, workspaces: 0, sessions: 0 });
      expect(
        (await readdir(baseDir)).some((entry) => entry.startsWith("app-state.recovery-")),
      ).toBe(true);

      const retried = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => "2026-08-09T10:01:00.000Z",
      });
      expect(retried.status).toBe("ready");
      expect(await sqlite.loadAppStateSnapshot()).toEqual(snapshot);
      expect(await sqlite.run((client) => readProviderSessions(client))).toEqual({
        "kimi:thread-1": "session-1",
      });
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("records a no-source marker only for a verified fresh install", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await sqlite.open();

      const result = await initializeSqliteAppState(sqlite, baseDir, { now: () => COMPLETED_AT });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready App State.");
      expect(result.source).toBe("fresh");
      expect(result.snapshot).toEqual({
        version: 1,
        workspaces: [],
        projects: [],
        associations: [],
        threads: [],
        threadDrafts: [],
        threadMessages: [],
        threadRuns: [],
        threadActions: [],
        threadPromotionIntents: [],
        threadWork: {},
        lastThreadIdByWorkspace: {},
        activeWorkspaceId: null,
      });
      expect(
        await sqlite.run((client) =>
          client.get<{ value: string }>(
            "SELECT value FROM app_metadata WHERE key = ?",
            "json-import-v1",
          ),
        ),
      ).toEqual({ value: JSON.stringify({ source: "none", completedAt: COMPLETED_AT }) });

      await writeFile(join(baseDir, "app-state.json"), JSON.stringify(completeSnapshot()), "utf-8");
      const restarted = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => "2026-08-09T10:03:00.000Z",
      });
      expect(restarted.status).toBe("ready");
      if (restarted.status !== "ready") throw new Error("Expected ready App State.");
      expect(restarted.source).toBe("sqlite");
      expect(restarted.snapshot).toEqual(result.snapshot);
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  for (const [evidenceName, kind] of [
    ["app-state.initialized", "file"],
    ["provider-sessions.json", "file"],
    ["attachments", "directory"],
    ["thread-deletion-journal.json", "file"],
    [".app-state-reset", "directory"],
    ["workspace.json", "file"],
    ["carrent-chat", "directory"],
    ["app-state.json.tmp-interrupted", "file"],
    ["provider-sessions.corrupt-interrupted.json", "file"],
    ["attachments-delete-interrupted", "directory"],
    ["attachments-backup-interrupted", "directory"],
  ] as const) {
    it(`requires recovery when ${evidenceName} remains without App State JSON`, async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
      const evidencePath = join(baseDir, evidenceName);
      const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      try {
        if (kind === "directory") await mkdir(evidencePath);
        else await writeFile(evidencePath, "evidence", "utf-8");
        await sqlite.open();

        const result = await initializeSqliteAppState(sqlite, baseDir, {
          now: () => COMPLETED_AT,
        });

        expect(result.status).toBe("recovery-required");
        expect(
          await sqlite.run((client) =>
            client.get("SELECT value FROM app_metadata WHERE key = ?", "json-import-v1"),
          ),
        ).toBe(null);
      } finally {
        await sqlite.close();
        await rm(baseDir, { recursive: true, force: true });
      }
    });
  }

  it("requires recovery when Carrent-owned evidence cannot be inspected", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await sqlite.open();
      const result = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => COMPLETED_AT,
        readDirectory: async () => {
          throw new Error("inspection denied with secret-session-id");
        },
      });

      expect(result.status).toBe("recovery-required");
      if (result.status !== "recovery-required") throw new Error("Expected recovery.");
      expect(result.diagnostics[0]?.summary).toContain("could not be inspected");
      expect(result.diagnostics[0]?.summary).not.toContain("secret-session-id");
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps SQLite authoritative when renaming the committed JSON source fails", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const snapshot = completeSnapshot();
    const appStatePath = join(baseDir, "app-state.json");
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(appStatePath, JSON.stringify(snapshot), "utf-8");
      await sqlite.open();
      const imported = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => COMPLETED_AT,
        renameFile: async () => {
          throw new Error("rename denied with secret-thread-title");
        },
      });

      expect(imported.status).toBe("ready");
      if (imported.status !== "ready") throw new Error("Expected ready App State.");
      expect(imported.diagnostics).toHaveLength(1);
      expect(imported.diagnostics[0]).not.toContain("secret-thread-title");
      await writeFile(appStatePath, "{malformed after commit", "utf-8");

      const restarted = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => "2026-08-09T10:02:00.000Z",
      });
      expect(restarted.status).toBe("ready");
      if (restarted.status !== "ready") throw new Error("Expected ready App State.");
      expect(restarted.source).toBe("sqlite");
      expect(restarted.snapshot).toEqual(snapshot);
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("compares normalized source and read-back using deterministic collection ordering", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const snapshot = completeSnapshot();
    snapshot.projects = [
      { id: "project-2", name: "Second", workingDirectory: "/work/second" },
      ...snapshot.projects,
    ];
    snapshot.associations = [
      {
        workspaceId: "workspace-1",
        projectId: "project-2",
        order: 1,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
      ...snapshot.associations,
    ];
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(join(baseDir, "app-state.json"), JSON.stringify(snapshot), "utf-8");
      await sqlite.open();

      const result = await initializeSqliteAppState(sqlite, baseDir, { now: () => COMPLETED_AT });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready App State.");
      expect(result.snapshot.projects.map((project) => project.id)).toEqual([
        "project-2",
        "project-1",
      ]);
      expect((await sqlite.loadAppStateSnapshot())?.projects.map((project) => project.id)).toEqual([
        "project-1",
        "project-2",
      ]);
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("rolls back every imported row and marker when repository read-back differs", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(
        join(baseDir, "app-state.json"),
        JSON.stringify(completeSnapshot(10 * 1024 * 1024)),
        "utf-8",
      );
      await writeFile(
        join(baseDir, "provider-sessions.json"),
        JSON.stringify({ version: 1, sessions: { "kimi:thread-1": "session-1" } }),
        "utf-8",
      );
      await sqlite.open();
      let mismatch: unknown;
      try {
        await initializeSqliteAppState(sqlite, baseDir, {
          now: () => COMPLETED_AT,
          beforeReadBack: (client) => {
            client.run("UPDATE workspaces SET name = ? WHERE id = ?", "Changed", "workspace-1");
          },
        });
      } catch (error) {
        mismatch = error;
      }

      expect(mismatch instanceof Error).toBe(true);
      expect(
        await sqlite.run((client) => ({
          marker: client.get("SELECT value FROM app_metadata WHERE key = ?", "json-import-v1"),
          workspaces: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM workspaces")
            ?.count,
          sessions: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM provider_sessions")
            ?.count,
        })),
      ).toEqual({ marker: null, workspaces: 0, sessions: 0 });
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("requires recovery without writing rows when the recovery copy cannot be created", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await writeFile(join(baseDir, "app-state.json"), JSON.stringify(completeSnapshot()), "utf-8");
      await sqlite.open();

      const result = await initializeSqliteAppState(sqlite, baseDir, {
        now: () => COMPLETED_AT,
        copySource: async () => {
          throw new Error("copy denied with secret-draft-content");
        },
      });

      expect(result.status).toBe("recovery-required");
      if (result.status !== "recovery-required") throw new Error("Expected recovery.");
      expect(result.diagnostics[0]?.summary).not.toContain("secret-draft-content");
      expect(
        await sqlite.run((client) => ({
          marker: client.get("SELECT value FROM app_metadata WHERE key = ?", "json-import-v1"),
          workspaces: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM workspaces")
            ?.count,
        })),
      ).toEqual({ marker: null, workspaces: 0 });
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("requires recovery when SQLite Runtime Sessions exist without a source or marker", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-import-"));
    const sqlite = createSqliteAppStateStore(join(baseDir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await sqlite.open();
      await sqlite.run((client) =>
        client.run(
          "INSERT INTO provider_sessions (session_key, session_id) VALUES (?, ?)",
          "kimi:thread-existing",
          "session-existing",
        ),
      );

      const result = await initializeSqliteAppState(sqlite, baseDir, { now: () => COMPLETED_AT });

      expect(result.status).toBe("recovery-required");
      expect(
        await sqlite.run((client) =>
          client.get("SELECT value FROM app_metadata WHERE key = ?", "json-import-v1"),
        ),
      ).toBe(null);
      expect(await sqlite.run((client) => readProviderSessions(client))).toEqual({
        "kimi:thread-existing": "session-existing",
      });
    } finally {
      await sqlite.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
