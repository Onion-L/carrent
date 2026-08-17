import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  APP_STATE_SNAPSHOT_VERSION,
  normalizeAppStateSnapshotForMemory,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { appStateCommandReducers } from "../workspace/appStateCommands";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore, type SqliteAppStateStore } from "./sqliteAppStateStore";

function snapshot(): AppStateSnapshot {
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [
      { id: "workspace-a", name: "Work", order: 0 },
      { id: "workspace-b", name: "Personal", order: 1 },
    ],
    projects: [
      { id: "project-a", name: "Carrent", workingDirectory: "/work/carrent" },
      { id: "project-b", name: "Shared", workingDirectory: "/work/shared" },
    ],
    associations: [
      {
        workspaceId: "workspace-a",
        projectId: "project-a",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "auto-accept-edits",
      },
      {
        workspaceId: "workspace-b",
        projectId: "project-b",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ],
    threads: [
      {
        id: "thread-a",
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "Keep this history",
        createdAt: "2026-08-09T08:00:00.000Z",
        lastActivityAt: "2026-08-09T09:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
      {
        id: "thread-b",
        workspaceId: "workspace-b",
        projectId: "project-b",
        title: "Personal history",
        createdAt: "2026-08-09T08:30:00.000Z",
        lastActivityAt: "2026-08-09T09:30:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadDrafts: [],
    threadMessages: [
      {
        id: "message-a",
        threadId: "thread-a",
        role: "user",
        content: "Do not rewrite me",
        createdAt: "2026-08-09T08:01:00.000Z",
        attachments: [],
      },
    ],
    threadRuns: [],
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
    lastThreadIdByWorkspace: { "workspace-a": "thread-a" },
    activeWorkspaceId: "workspace-a",
  };
}

function command(type: string, payload?: unknown): AppStateCommand {
  return { commandId: `command:${type}`, type, payload };
}

function reduce(before: AppStateSnapshot, value: AppStateCommand): AppStateSnapshot {
  const produced = appStateCommandReducers[value.type]?.(before, value.payload);
  if (!produced) throw new Error(`Fixture command was rejected: ${value.type}`);
  const next = "snapshot" in produced ? produced.snapshot : produced;
  const normalized = normalizeAppStateSnapshotForMemory(next);
  if (!normalized) throw new Error(`Fixture command produced invalid state: ${value.type}`);
  return normalized;
}

async function installWriteAudit(store: SqliteAppStateStore): Promise<void> {
  const tables: Array<[string, (row: "OLD" | "NEW") => string]> = [
    ["workspaces", (row) => `${row}.id`],
    ["projects", (row) => `${row}.id`],
    ["workspace_project_associations", (row) => `${row}.workspace_id || '/' || ${row}.project_id`],
    ["settings", (row) => `${row}.id`],
    ["app_metadata", (row) => `${row}.key`],
    ["workspace_last_threads", (row) => `${row}.workspace_id`],
    ["threads", (row) => `${row}.id`],
    ["thread_messages", (row) => `${row}.id`],
  ];
  await store.run((client) => {
    client.run("CREATE TEMP TABLE write_audit (entry TEXT NOT NULL)");
    for (const [table, key] of tables) {
      for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
        const row = operation === "DELETE" ? "OLD" : "NEW";
        client.run(
          `CREATE TEMP TRIGGER audit_${table}_${operation.toLowerCase()}
           AFTER ${operation} ON ${table}
           BEGIN
             INSERT INTO write_audit (entry) VALUES ('${table}:${operation.toLowerCase()}:' || ${key(row)});
           END`,
        );
      }
    }
  });
}

async function auditedEntries(store: SqliteAppStateStore): Promise<string[]> {
  return store.run((client) =>
    client
      .all<{ entry: string }>("SELECT entry FROM write_audit ORDER BY entry")
      .map((row) => row.entry),
  );
}

async function withStore(
  run: (store: SqliteAppStateStore, before: AppStateSnapshot) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-commands-"));
  const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
    driver: bunSqliteDriver,
  });
  try {
    await store.open();
    const before = snapshot();
    await store.saveAppStateSnapshot(before);
    await installWriteAudit(store);
    await run(store, before);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("SQLite App State command persistence", () => {
  const cases: Array<{
    name: string;
    value: AppStateCommand;
    writes: string[];
  }> = [
    {
      name: "creates a Workspace with its new Project and Association",
      value: command("workspace:create", {
        workspace: { id: "workspace-c", name: "Client", order: 2 },
        projects: [{ id: "project-c", name: "Client app", workingDirectory: "/work/client" }],
        associations: [
          {
            workspaceId: "workspace-c",
            projectId: "project-c",
            order: 0,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "full-access",
          },
        ],
      }),
      writes: [
        "app_metadata:update:active_workspace_id",
        "projects:insert:project-c",
        "workspace_project_associations:insert:workspace-c/project-c",
        "workspaces:insert:workspace-c",
      ],
    },
    {
      name: "renames one Workspace",
      value: command("workspace:rename", { workspaceId: "workspace-a", name: "Studio" }),
      writes: ["workspaces:update:workspace-a"],
    },
    {
      name: "adds a new Project and Association",
      value: command("project:add", {
        workspaceId: "workspace-b",
        project: { id: "project-c", name: "Client app", workingDirectory: "/work/client" },
        association: {
          workspaceId: "workspace-b",
          projectId: "project-c",
          order: 1,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "full-access",
        },
      }),
      writes: [
        "projects:insert:project-c",
        "workspace_project_associations:insert:workspace-b/project-c",
      ],
    },
    {
      name: "associates an existing shared Project without rewriting it",
      value: command("project:add", {
        workspaceId: "workspace-b",
        existingProjectId: "project-a",
        association: {
          workspaceId: "workspace-b",
          projectId: "project-a",
          order: 1,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      }),
      writes: ["workspace_project_associations:insert:workspace-b/project-a"],
    },
    {
      name: "renames one shared Project",
      value: command("project:rename", { projectId: "project-a", name: "Carrent Desktop" }),
      writes: ["projects:update:project-a"],
    },
    {
      name: "updates one Association alias",
      value: command("project:set-alias", {
        workspaceId: "workspace-a",
        projectId: "project-a",
        alias: "Desktop",
      }),
      writes: ["workspace_project_associations:update:workspace-a/project-a"],
    },
    {
      name: "updates one Association's defaults",
      value: command("association:set-defaults", {
        workspaceId: "workspace-a",
        projectId: "project-a",
        defaults: {
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "full-access",
        },
      }),
      writes: ["workspace_project_associations:update:workspace-a/project-a"],
    },
    {
      name: "updates Settings",
      value: command("settings:update", { settings: { theme: "dark", fontSize: 17 } }),
      writes: ["settings:update:1"],
    },
    {
      name: "selects one Workspace",
      value: command("state:select-workspace", { workspaceId: "workspace-b" }),
      writes: ["app_metadata:update:active_workspace_id"],
    },
    {
      name: "remembers a Thread location and selects its Workspace",
      value: command("state:remember-thread-location", {
        workspaceId: "workspace-b",
        threadId: "thread-b",
      }),
      writes: [
        "app_metadata:update:active_workspace_id",
        "workspace_last_threads:insert:workspace-b",
      ],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      await withStore(async (store, before) => {
        const after = reduce(before, testCase.value);

        await store.persistAppStateCommand(testCase.value, before, after);

        expect(await store.loadAppStateSnapshot()).toEqual(after);
        expect(await auditedEntries(store)).toEqual([...testCase.writes].sort());
      });
    });
  }

  it("rejects unknown and destructive command types without writing", async () => {
    await withStore(async (store, before) => {
      for (const type of ["unknown:command", "workspace:delete", "association:remove"]) {
        let message = "";
        try {
          await store.persistAppStateCommand(command(type), before, before);
        } catch (error) {
          message = String(error);
        }
        expect(message).toContain(`Unsupported incremental App State command: ${type}`);
      }
      expect(await auditedEntries(store)).toEqual([]);
      expect(await store.loadAppStateSnapshot()).toEqual(before);
    });
  });

  it("rolls back every row when a command mapping fails", async () => {
    await withStore(async (store, before) => {
      const value = command("workspace:create", {
        workspace: { id: "workspace-c", name: "Client", order: 2 },
        projects: [{ id: "project-c", name: "Client app", workingDirectory: "/work/client" }],
        associations: [
          {
            workspaceId: "workspace-c",
            projectId: "project-c",
            order: 0,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "full-access",
          },
        ],
      });
      const after = reduce(before, value);
      await store.run((client) =>
        client.run(
          `CREATE TEMP TRIGGER fail_association_insert
           BEFORE INSERT ON workspace_project_associations
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
      expect(await store.loadAppStateSnapshot()).toEqual(before);
      expect(await auditedEntries(store)).toEqual([]);
    });
  });
});
