import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAppStateStore } from "./appStateStore";
import type {
  ProviderSessionSnapshot,
  AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "carrent-workspace-store-"));
}

async function failRemoval(): Promise<never> {
  throw new Error("remove denied");
}

async function caughtError(operation: () => unknown): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
}

const emptyAppStatePayload = JSON.stringify(createEmptyAppStateSnapshot(), null, 2);

const missingAppStateEvidenceCases: ReadonlyArray<
  readonly [evidenceName: string, evidenceType: "file" | "directory"]
> = [
  ["provider-sessions.json", "file"],
  ["attachments", "directory"],
  ["attachments-delete-interrupted", "directory"],
  ["attachments-backup-interrupted", "directory"],
  ["carrent-chat", "directory"],
  ["thread-deletion-journal.json", "file"],
];

describe("createAppStateStore", () => {
  it("initializes first use with an empty current App State", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);

    const result = await store.initializeAppState();

    expect(result).toEqual({
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
        threadActions: [],
        threadPromotionIntents: [],
        threadWork: {},
        lastThreadIdByWorkspace: {},
        activeWorkspaceId: null,
      },
    });
    expect(await readFile(join(baseDir, "app-state.json"), "utf-8")).toContain('"version": 1');
  });

  it("treats an established App State file that disappears as corruption", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    await store.initializeAppState();
    await rm(join(baseDir, "app-state.json"));

    const result = await store.initializeAppState();

    expect(result.status).toBe("recovery-required");
    if (result.status === "recovery-required") {
      expect(result.diagnostics.at(-1)?.stage).toBe("read");
      expect(result.diagnostics.at(-1)?.summary).toContain("missing");
    }
  });

  for (const [evidenceName, evidenceType] of missingAppStateEvidenceCases) {
    it(`treats missing App State with remaining ${evidenceName} as corruption`, async () => {
      const baseDir = await makeTempDir();
      const evidencePath = join(baseDir, evidenceName);
      if (evidenceType === "directory") {
        await mkdir(evidencePath);
        await writeFile(join(evidencePath, "keep.txt"), "sensitive evidence", "utf-8");
      } else {
        await writeFile(evidencePath, "sensitive evidence", "utf-8");
      }

      const result = await createAppStateStore(baseDir).initializeAppState();

      expect(result.status).toBe("recovery-required");
      if (result.status === "recovery-required") {
        expect(result.diagnostics.at(-1)?.stage).toBe("read");
      }
      expect(await readdir(baseDir)).toContain(evidenceName);
      expect(await readdir(baseDir)).not.toContain("app-state.json");
      expect(await readdir(baseDir)).not.toContain("app-state.initialized");
      expect(
        await readFile(
          evidenceType === "directory" ? join(evidencePath, "keep.txt") : evidencePath,
          "utf-8",
        ),
      ).toBe("sensitive evidence");
    });
  }

  it("preserves malformed and unsupported App State files", async () => {
    const malformedDir = await makeTempDir();
    const malformedPath = join(malformedDir, "app-state.json");
    await writeFile(malformedPath, "{partial", "utf-8");
    const malformed = await createAppStateStore(malformedDir).initializeAppState();
    expect(malformed.status).toBe("recovery-required");
    expect(await readFile(malformedPath, "utf-8")).toBe("{partial");

    const unknownDir = await makeTempDir();
    const unknownPath = join(unknownDir, "app-state.json");
    const unknownSchema = '{"version":999,"private":"keep"}';
    await writeFile(unknownPath, unknownSchema, "utf-8");
    const unknown = await createAppStateStore(unknownDir).initializeAppState();
    expect(unknown.status).toBe("recovery-required");
    if (unknown.status === "recovery-required") {
      expect(unknown.diagnostics.at(-1)?.stage).toBe("schema-version");
    }
    expect(await readFile(unknownPath, "utf-8")).toBe(unknownSchema);
  });

  it("does not include malformed App State content in parse diagnostics", async () => {
    const baseDir = await makeTempDir();
    const appStatePath = join(baseDir, "app-state.json");
    const sensitiveValues = [
      "private message",
      "private draft",
      "private attachment content",
      "private provider configuration",
    ];
    await writeFile(
      appStatePath,
      `{"messages":["${sensitiveValues[0]}"],"draft":"${sensitiveValues[1]}","attachment":"${sensitiveValues[2]}","provider":"${sensitiveValues[3]}",`,
      "utf-8",
    );

    const result = await createAppStateStore(baseDir).initializeAppState();

    expect(result.status).toBe("recovery-required");
    if (result.status === "recovery-required") {
      const parseDiagnostic = result.diagnostics.at(-1);
      expect(parseDiagnostic?.stage).toBe("parse");
      expect(parseDiagnostic?.summary).toBe("App State JSON is malformed.");
      for (const sensitiveValue of sensitiveValues) {
        expect(parseDiagnostic?.summary).not.toContain(sensitiveValue);
      }
    }
  });

  it("rejects a truncated current App State snapshot", async () => {
    const baseDir = await makeTempDir();
    const appStatePath = join(baseDir, "app-state.json");
    const truncated = JSON.stringify({
      version: 1,
      workspaces: [],
      projects: [],
      associations: [],
      activeWorkspaceId: null,
    });
    await writeFile(appStatePath, truncated, "utf-8");
    const store = createAppStateStore(baseDir);

    const result = await store.initializeAppState();

    expect(result.status).toBe("recovery-required");
    if (result.status === "recovery-required") {
      expect(result.diagnostics.at(-1)?.stage).toBe("validate");
    }
    expect(await store.loadAppStateSnapshot()).toBe(null);
    expect(await readFile(appStatePath, "utf-8")).toBe(truncated);
  });

  it("resets a recognized legacy snapshot within Carrent app data", async () => {
    const baseDir = await makeTempDir();
    const projectDir = await makeTempDir();
    await writeFile(
      join(baseDir, "workspace.json"),
      JSON.stringify({ version: 1, projects: [], chats: [], messages: [], activeThreadId: null }),
      "utf-8",
    );
    await writeFile(
      join(baseDir, "provider-sessions.json"),
      JSON.stringify({ version: 1, sessions: { legacy: "session" } }),
      "utf-8",
    );
    await mkdir(join(baseDir, "attachments"));
    await writeFile(join(baseDir, "attachments", "legacy.txt"), "legacy", "utf-8");
    await mkdir(join(baseDir, "attachments-delete-legacy-operation"));
    await writeFile(
      join(baseDir, "attachments-delete-legacy-operation", "legacy.txt"),
      "legacy",
      "utf-8",
    );
    await mkdir(join(baseDir, "attachments-backup-legacy-operation"));
    await writeFile(
      join(baseDir, "attachments-backup-legacy-operation", "legacy.txt"),
      "legacy",
      "utf-8",
    );
    await mkdir(join(baseDir, "carrent-chat"));
    await writeFile(join(baseDir, "carrent-chat", "legacy.txt"), "legacy", "utf-8");
    await writeFile(join(projectDir, "keep.txt"), "project data", "utf-8");

    const result = await createAppStateStore(baseDir).initializeAppState();

    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.notice).toBe("legacy-reset");
    expect(await readdir(baseDir)).not.toContain("workspace.json");
    expect(await readdir(baseDir)).not.toContain("provider-sessions.json");
    expect(await readdir(baseDir)).not.toContain("attachments");
    expect(await readdir(baseDir)).not.toContain("attachments-delete-legacy-operation");
    expect(await readdir(baseDir)).not.toContain("attachments-backup-legacy-operation");
    expect(await readdir(baseDir)).not.toContain("carrent-chat");
    expect(await readFile(join(projectDir, "keep.txt"), "utf-8")).toBe("project data");
  });

  it("blocks initialization when legacy reset cannot rename owned data", async () => {
    const baseDir = await makeTempDir();
    const workspacePath = join(baseDir, "workspace.json");
    const legacy = JSON.stringify({
      version: 1,
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    });
    await writeFile(workspacePath, legacy, "utf-8");
    const store = createAppStateStore(baseDir, {
      rename: async () => {
        throw new Error("rename denied");
      },
    });

    const result = await store.initializeAppState();

    expect(result.status).toBe("recovery-required");
    expect(await readFile(workspacePath, "utf-8")).toBe(legacy);
    expect(await readdir(baseDir)).not.toContain("app-state.json");
  });

  it("restores complete legacy data when a later staging move fails", async () => {
    const baseDir = await makeTempDir();
    const workspacePath = join(baseDir, "workspace.json");
    const providerSessionsPath = join(baseDir, "provider-sessions.json");
    const legacyWorkspace = JSON.stringify({
      version: 1,
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    });
    const providerSessions = '{"version":1,"sessions":{"legacy":"session"}}';
    await writeFile(workspacePath, legacyWorkspace, "utf-8");
    await writeFile(providerSessionsPath, providerSessions, "utf-8");
    const rootStateBeforeReset = (await readdir(baseDir)).sort();
    const store = createAppStateStore(baseDir, {
      rename: async (from, to) => {
        if (from === providerSessionsPath) throw new Error("provider move denied");
        await rename(from, to);
      },
    });

    const result = await store.initializeAppState();

    expect(result.status).toBe("recovery-required");
    expect((await readdir(baseDir)).sort()).toEqual(rootStateBeforeReset);
    expect(await readFile(workspacePath, "utf-8")).toBe(legacyWorkspace);
    expect(await readFile(providerSessionsPath, "utf-8")).toBe(providerSessions);
  });

  it("blocks initialization when the reset snapshot cannot be written", async () => {
    const baseDir = await makeTempDir();
    const workspacePath = join(baseDir, "workspace.json");
    const legacy = JSON.stringify({
      version: 1,
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    });
    await writeFile(workspacePath, legacy, "utf-8");
    const store = createAppStateStore(baseDir, {
      writeFile: async (path, data, encoding) => {
        if (data === emptyAppStatePayload) throw new Error("disk full");
        await writeFile(path, data, encoding);
      },
    });

    const result = await store.initializeAppState();

    expect(result.status).toBe("recovery-required");
    expect(await readFile(workspacePath, "utf-8")).toBe(legacy);
    expect(await readdir(baseDir)).not.toContain("app-state.json");
  });

  it("preserves all legacy data when reset deletion fails", async () => {
    const baseDir = await makeTempDir();
    const workspacePath = join(baseDir, "workspace.json");
    const providerSessionsPath = join(baseDir, "provider-sessions.json");
    const attachmentPath = join(baseDir, "attachments", "legacy.txt");
    const legacyWorkspace = JSON.stringify({
      version: 1,
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    });
    const providerSessions = '{"version":1,"sessions":{"legacy":"session"}}';
    await writeFile(workspacePath, legacyWorkspace, "utf-8");
    await writeFile(providerSessionsPath, providerSessions, "utf-8");
    await mkdir(join(baseDir, "attachments"));
    await writeFile(attachmentPath, "legacy attachment", "utf-8");

    const store = createAppStateStore(baseDir, { remove: failRemoval });

    const result = await store.initializeAppState();

    expect(result.status).toBe("recovery-required");
    expect(await readFile(workspacePath, "utf-8")).toBe(legacyWorkspace);
    expect(await readFile(providerSessionsPath, "utf-8")).toBe(providerSessions);
    expect(await readFile(attachmentPath, "utf-8")).toBe("legacy attachment");
    expect(await readdir(baseDir)).not.toContain("app-state.json");
  });

  it("fully resets blocked App State and returns to first use", async () => {
    const baseDir = await makeTempDir();
    await writeFile(join(baseDir, "app-state.json"), '{"version":999}', "utf-8");
    await writeFile(join(baseDir, "provider-sessions.json"), '{"version":1,"sessions":{}}');
    await mkdir(join(baseDir, "attachments"));
    await mkdir(join(baseDir, "attachments-delete-full-reset-operation"));
    await mkdir(join(baseDir, "attachments-backup-full-reset-operation"));
    const store = createAppStateStore(baseDir);
    expect((await store.initializeAppState()).status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.notice).toBe("full-reset");
      expect(result.snapshot.workspaces).toEqual([]);
    }
    expect(await readdir(baseDir)).not.toContain("provider-sessions.json");
    expect(await readdir(baseDir)).not.toContain("attachments");
    expect(await readdir(baseDir)).not.toContain("attachments-delete-full-reset-operation");
    expect(await readdir(baseDir)).not.toContain("attachments-backup-full-reset-operation");
  });

  it("resets an interrupted public atomic write without restoring its payload", async () => {
    const baseDir = await makeTempDir();
    await createAppStateStore(baseDir).initializeAppState();
    const interruptedSnapshot: AppStateSnapshot = {
      ...createEmptyAppStateSnapshot(),
      workspaces: [{ id: "workspace-old", name: "Old", order: 0 }],
      activeWorkspaceId: "workspace-old",
    };
    const interruptedPayload = JSON.stringify(interruptedSnapshot, null, 2);
    let interruptedWritePath: string | undefined;
    const interruptedStore = createAppStateStore(baseDir, {
      writeFile: async (path, data, encoding) => {
        if (data === interruptedPayload) interruptedWritePath = path;
        await writeFile(path, data, encoding);
      },
      rename: async (from, to) => {
        if (from === interruptedWritePath) throw new Error("rename interrupted");
        await rename(from, to);
      },
      remove: async (path, options) => {
        if (path === interruptedWritePath) throw new Error("cleanup interrupted");
        await rm(path, options);
      },
    });
    expect(
      String(await caughtError(() => interruptedStore.saveAppStateSnapshot(interruptedSnapshot))),
    ).toContain("rename interrupted");
    expect(await interruptedStore.loadAppStateSnapshot()).toEqual(createEmptyAppStateSnapshot());

    await rm(join(baseDir, "app-state.json"));
    await rm(join(baseDir, "app-state.initialized"));
    const store = createAppStateStore(baseDir);
    expect((await store.initializeAppState()).status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("ready");
    const restartedStore = createAppStateStore(baseDir);
    expect((await restartedStore.initializeAppState()).status).toBe("ready");
    expect(await restartedStore.loadAppStateSnapshot()).toEqual(createEmptyAppStateSnapshot());

    await rm(join(baseDir, "app-state.json"));
    await rm(join(baseDir, "app-state.initialized"));
    expect((await createAppStateStore(baseDir).initializeAppState()).status).toBe("ready");
  });

  it("preserves blocked App State when the first reset move fails", async () => {
    const baseDir = await makeTempDir();
    const appStatePath = join(baseDir, "app-state.json");
    const unknownSchema = '{"version":999,"private":"keep"}';
    await writeFile(appStatePath, unknownSchema, "utf-8");
    const store = createAppStateStore(baseDir, {
      rename: async () => {
        throw new Error("rename denied");
      },
    });
    expect((await store.initializeAppState()).status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("recovery-required");
    expect(await readFile(appStatePath, "utf-8")).toBe(unknownSchema);
    expect((await store.initializeAppState()).status).toBe("recovery-required");
  });

  it("preserves blocked App State when the Full Reset snapshot write fails", async () => {
    const baseDir = await makeTempDir();
    const appStatePath = join(baseDir, "app-state.json");
    const providerSessionsPath = join(baseDir, "provider-sessions.json");
    const unknownSchema = '{"version":999,"private":"keep"}';
    const providerSessions = '{"version":1,"sessions":{"kimi:thread-1":"session-1"}}';
    await writeFile(appStatePath, unknownSchema, "utf-8");
    await writeFile(providerSessionsPath, providerSessions, "utf-8");
    const store = createAppStateStore(baseDir, {
      writeFile: async (path, data, encoding) => {
        if (data === emptyAppStatePayload) throw new Error("disk full");
        await writeFile(path, data, encoding);
      },
    });
    const initialResult = await store.initializeAppState();
    expect(initialResult.status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("recovery-required");
    if (initialResult.status === "recovery-required" && result.status === "recovery-required") {
      expect(result.diagnostics.slice(0, -1)).toEqual(initialResult.diagnostics);
      expect(result.diagnostics.at(-1)?.stage).toBe("reset-write");
      expect(result.diagnostics.at(-1)?.summary).toContain("disk full");
    }
    expect(await readFile(appStatePath, "utf-8")).toBe(unknownSchema);
    expect(await readFile(providerSessionsPath, "utf-8")).toBe(providerSessions);
  });

  it("restores complete blocked data when the final reset snapshot rename fails", async () => {
    const baseDir = await makeTempDir();
    const appStatePath = join(baseDir, "app-state.json");
    const providerSessionsPath = join(baseDir, "provider-sessions.json");
    const unknownSchema = '{"version":999,"private":"keep"}';
    const providerSessions = '{"version":1,"sessions":{"kimi:thread-1":"session-1"}}';
    await writeFile(appStatePath, unknownSchema, "utf-8");
    await writeFile(providerSessionsPath, providerSessions, "utf-8");
    const rootStateBeforeReset = (await readdir(baseDir)).sort();
    let resetSnapshotPath: string | undefined;
    const store = createAppStateStore(baseDir, {
      writeFile: async (path, data, encoding) => {
        if (data === emptyAppStatePayload) resetSnapshotPath = path;
        await writeFile(path, data, encoding);
      },
      rename: async (from, to) => {
        if (to === appStatePath && from === resetSnapshotPath) {
          throw new Error("final rename denied");
        }
        await rename(from, to);
      },
    });
    expect((await store.initializeAppState()).status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("recovery-required");
    expect((await readdir(baseDir)).sort()).toEqual(rootStateBeforeReset);
    expect(await readFile(appStatePath, "utf-8")).toBe(unknownSchema);
    expect(await readFile(providerSessionsPath, "utf-8")).toBe(providerSessions);
    expect((await store.initializeAppState()).status).toBe("recovery-required");
  });

  it("retries to a complete reset state after rollback cannot restore an item", async () => {
    const baseDir = await makeTempDir();
    const appStatePath = join(baseDir, "app-state.json");
    const providerSessionsPath = join(baseDir, "provider-sessions.json");
    const unknownSchema = '{"version":999,"private":"keep"}';
    const providerSessions = '{"version":1,"sessions":{"kimi:thread-1":"session-1"}}';
    await writeFile(appStatePath, unknownSchema, "utf-8");
    await writeFile(providerSessionsPath, providerSessions, "utf-8");
    let resetSnapshotPath: string | undefined;
    let resetSnapshotRenameFailurePending = true;
    let providerRestoreFailurePending = true;
    const store = createAppStateStore(baseDir, {
      writeFile: async (path, data, encoding) => {
        if (data === emptyAppStatePayload) resetSnapshotPath = path;
        await writeFile(path, data, encoding);
      },
      rename: async (from, to) => {
        if (
          to === appStatePath &&
          from === resetSnapshotPath &&
          resetSnapshotRenameFailurePending
        ) {
          resetSnapshotRenameFailurePending = false;
          throw new Error("final rename denied");
        }
        if (to === providerSessionsPath && providerRestoreFailurePending) {
          providerRestoreFailurePending = false;
          throw new Error("provider restore denied");
        }
        await rename(from, to);
      },
    });
    expect((await store.initializeAppState()).status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("recovery-required");
    expect(
      String(await caughtError(() => store.saveAppStateSnapshot(createEmptyAppStateSnapshot()))),
    ).toContain("App State recovery is required");

    const retriedResult = await store.fullResetAppState();

    expect(retriedResult).toEqual({
      status: "ready",
      snapshot: createEmptyAppStateSnapshot(),
      notice: "full-reset",
    });
    expect(await store.loadAppStateSnapshot()).toEqual(createEmptyAppStateSnapshot());
    expect(await store.loadProviderSessions()).toEqual({ version: 1, sessions: {} });
  });

  it("retries to a complete reset state after final cleanup fails", async () => {
    const baseDir = await makeTempDir();
    const unknownSchema = '{"version":999,"private":"keep"}';
    const providerSessions = '{"version":1,"sessions":{"kimi:thread-1":"session-1"}}';
    await writeFile(join(baseDir, "app-state.json"), unknownSchema, "utf-8");
    await writeFile(join(baseDir, "provider-sessions.json"), providerSessions, "utf-8");
    let cleanupFailurePending = true;
    const store = createAppStateStore(baseDir, {
      remove: async (path, options) => {
        try {
          if ((await stat(path)).isDirectory() && cleanupFailurePending) {
            cleanupFailurePending = false;
            throw new Error("cleanup denied");
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rm(path, options);
      },
    });
    expect((await store.initializeAppState()).status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("recovery-required");
    expect(
      String(await caughtError(() => store.saveAppStateSnapshot(createEmptyAppStateSnapshot()))),
    ).toContain("App State recovery is required");

    const retriedResult = await store.fullResetAppState();

    expect(retriedResult).toEqual({
      status: "ready",
      snapshot: createEmptyAppStateSnapshot(),
      notice: "full-reset",
    });
    expect(await store.loadAppStateSnapshot()).toEqual(createEmptyAppStateSnapshot());
    expect(await store.loadProviderSessions()).toEqual({ version: 1, sessions: {} });
  });

  it("preserves all Carrent data when Full Reset deletion fails", async () => {
    const baseDir = await makeTempDir();
    const appStatePath = join(baseDir, "app-state.json");
    const providerSessionsPath = join(baseDir, "provider-sessions.json");
    const attachmentPath = join(baseDir, "attachments", "keep.txt");
    const unknownSchema = '{"version":999,"private":"keep"}';
    const providerSessions = '{"version":1,"sessions":{"kimi:thread-1":"session-1"}}';
    await writeFile(appStatePath, unknownSchema, "utf-8");
    await writeFile(providerSessionsPath, providerSessions, "utf-8");
    await mkdir(join(baseDir, "attachments"));
    await writeFile(attachmentPath, "attachment data", "utf-8");
    const store = createAppStateStore(baseDir, { remove: failRemoval });
    expect((await store.initializeAppState()).status).toBe("recovery-required");

    const result = await store.fullResetAppState();

    expect(result.status).toBe("recovery-required");
    expect(await readFile(appStatePath, "utf-8")).toBe(unknownSchema);
    expect(await readFile(providerSessionsPath, "utf-8")).toBe(providerSessions);
    expect(await readFile(attachmentPath, "utf-8")).toBe("attachment data");
  });

  it("writes and reads the App State snapshot", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    const snapshot: AppStateSnapshot = {
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          alias: "Client Carrent",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeModelId: "gpt-5",
          defaultRuntimeMode: "auto-accept-edits",
        },
      ],
      activeWorkspaceId: "workspace-2",
    };

    await store.saveAppStateSnapshot(snapshot);

    expect(await store.loadAppStateSnapshot()).toEqual({
      ...snapshot,
      threads: [],
      threadDrafts: [],
      threadMessages: [],
      threadRuns: [],
      threadPromotionIntents: [],
      threadWork: {},
      lastThreadIdByWorkspace: {},
    });
  });

  it("rejects invalid Workspace data before writing App State", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    const snapshot = {
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: " personal ", order: 1 },
      ],
      projects: [],
      associations: [],
      activeWorkspaceId: "workspace-1",
    } as AppStateSnapshot;

    let saveError: unknown;
    try {
      await store.saveAppStateSnapshot(snapshot);
    } catch (error) {
      saveError = error;
    }

    expect(String(saveError)).toContain("Invalid App State snapshot");
    expect(await readdir(baseDir)).not.toContain("app-state.json");
  });

  it("rejects App State attachments without an explicit kind before writing", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    const snapshot = {
      version: 1,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
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
          title: "Attachment schema",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Inspect this image",
          createdAt: "2026-07-27T08:00:00.000Z",
          attachments: [
            {
              id: "attachment-1",
              name: "screen.png",
              mimeType: "image/png",
              size: 10,
              storageKey: "attachment-1.png",
            },
          ],
        },
      ],
      activeWorkspaceId: "workspace-1",
    } as AppStateSnapshot;

    let saveError: unknown;
    try {
      await store.saveAppStateSnapshot(snapshot);
    } catch (error) {
      saveError = error;
    }

    expect(String(saveError)).toContain("Invalid App State snapshot");
    await store.waitForWrites();
    expect(await readdir(baseDir)).not.toContain("app-state.json");
  });

  it("rejects App State with an orphaned Project before writing", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    const snapshot: AppStateSnapshot = {
      version: 1,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [],
      activeWorkspaceId: "workspace-1",
    };

    let saveError: unknown;
    try {
      await store.saveAppStateSnapshot(snapshot);
    } catch (error) {
      saveError = error;
    }

    expect(String(saveError)).toContain("Invalid App State snapshot");
    expect(await readdir(baseDir)).not.toContain("app-state.json");
  });

  it("writes and reads provider sessions", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    const snapshot: ProviderSessionSnapshot = {
      version: 1,
      sessions: { "kimi:thread-1": "sess-abc" },
    };

    await store.saveProviderSessions(snapshot);
    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual(snapshot);
  });

  it("returns empty sessions for missing provider file", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual({ version: 1, sessions: {} });
  });

  it("renames corrupt provider sessions json to corrupt backup", async () => {
    const baseDir = await makeTempDir();
    const store = createAppStateStore(baseDir);
    const path = join(baseDir, "provider-sessions.json");
    await writeFile(path, "not-json", "utf-8");

    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual({ version: 1, sessions: {} });

    const files = await readdir(baseDir);
    expect(files.some((f) => f.startsWith("provider-sessions.corrupt-"))).toBe(true);
  });
});
