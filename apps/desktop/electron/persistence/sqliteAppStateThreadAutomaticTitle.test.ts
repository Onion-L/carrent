import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import {
  APP_STATE_SNAPSHOT_VERSION,
  normalizeAppStateSnapshotForMemory,
  type AppStateSnapshot,
  type AppThreadRecord,
} from "../../src/shared/workspacePersistence";
import { appStateCommandReducers } from "../workspace/appStateCommands";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore, type SqliteAppStateStore } from "./sqliteAppStateStore";

// A snapshot with one association, one eligible Thread titled with the
// deterministic fallback, and no manual-title marker. Each test overrides the
// Thread row as needed.
function baseSnapshot(overrides: Partial<AppThreadRecord> = {}): AppStateSnapshot {
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
        defaultRuntimeMode: "approval-required",
      },
    ],
    threads: [
      {
        id: "thread-a",
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "New thread",
        createdAt: "2026-08-09T09:00:00.000Z",
        lastActivityAt: "2026-08-09T09:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
        ...overrides,
      },
    ],
    threadDrafts: [],
    threadMessages: [],
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
    lastThreadIdByWorkspace: {},
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

async function withStore(
  before: AppStateSnapshot,
  run: (store: SqliteAppStateStore, before: AppStateSnapshot) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-title-"));
  const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
    driver: bunSqliteDriver,
  });
  try {
    await store.open();
    await store.saveAppStateSnapshot(before);
    await run(store, before);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function readThread(store: SqliteAppStateStore, threadId: string) {
  const loaded = await store.loadAppStateSnapshot();
  return (loaded?.threads ?? []).find((thread) => thread.id === threadId) ?? null;
}

describe("SQLite App State automatic Thread title persistence", () => {
  it("persists a thread:set-automatic-title update to the title column", async () => {
    const before = baseSnapshot();
    const value = command("thread:set-automatic-title", {
      threadId: "thread-a",
      expectedTitle: "New thread",
      title: "Generated summary",
    });
    const after = reduce(before, value);

    await withStore(before, async (store) => {
      await store.persistAppStateCommand(value, before, after);
      expect(await store.loadAppStateSnapshot()).toEqual(after);
      const thread = await readThread(store, "thread-a");
      expect(thread?.title).toBe("Generated summary");
      // An automatic update never sets the manual-title marker.
      expect(thread?.customTitle).toBe(undefined);
    });
  });

  it("persists a manual rename through thread-content:update with customTitle", async () => {
    const before = baseSnapshot();
    const value = command("thread-content:update", {
      threadId: "thread-a",
      thread: { title: "My manual name", customTitle: true },
    });
    const after = reduce(before, value);

    await withStore(before, async (store) => {
      await store.persistAppStateCommand(value, before, after);
      expect(await store.loadAppStateSnapshot()).toEqual(after);
      const thread = await readThread(store, "thread-a");
      expect(thread?.title).toBe("My manual name");
      expect(thread?.customTitle).toBe(true);
    });
  });

  it("clears the custom_title column when customTitle is set back to false", async () => {
    const before = baseSnapshot({ title: "Manual", customTitle: true });
    const value = command("thread-content:update", {
      threadId: "thread-a",
      thread: { customTitle: false },
    });
    const after = reduce(before, value);

    await withStore(before, async (store) => {
      await store.persistAppStateCommand(value, before, after);
      const thread = await readThread(store, "thread-a");
      expect(thread?.title).toBe("Manual");
      expect(thread?.customTitle).toBe(undefined);
    });
  });

  it("leaves a manually titled Thread untouched by thread:set-automatic-title", async () => {
    // The reducer rejects a manual-marker Thread before producing a snapshot;
    // a rejected command never reaches persistAppStateCommand. This proves the
    // rejection round-trips: after the rejected attempt the row is unchanged.
    const before = baseSnapshot({ title: "Manual", customTitle: true });
    const rejected = appStateCommandReducers["thread:set-automatic-title"]?.(before, {
      threadId: "thread-a",
      expectedTitle: "Manual",
      title: "Automatic override",
    });
    expect(rejected).toBe(null);

    await withStore(before, async (store) => {
      const thread = await readThread(store, "thread-a");
      expect(thread?.title).toBe("Manual");
      expect(thread?.customTitle).toBe(true);
    });
  });

  it("does not write the Thread row when thread:set-automatic-title is a no-op", async () => {
    // The reducer returns the same snapshot reference when the new title equals
    // the current one; persistAppStateCommand then writes nothing for the Thread
    // because threadMetadataIdentity is unchanged.
    const before = baseSnapshot({ title: "Same title" });
    const value = command("thread:set-automatic-title", {
      threadId: "thread-a",
      expectedTitle: "Same title",
      title: "Same title",
    });
    // The reducer returns the same reference for a no-op.
    const produced = appStateCommandReducers["thread:set-automatic-title"]?.(before, value.payload);
    expect(produced).toBe(before);

    await withStore(before, async (store) => {
      // Persisting the no-op command is a safe call; it must not corrupt state.
      await store.persistAppStateCommand(value, before, before);
      const thread = await readThread(store, "thread-a");
      expect(thread?.title).toBe("Same title");
      expect(thread?.customTitle).toBe(undefined);
    });
  });
});
