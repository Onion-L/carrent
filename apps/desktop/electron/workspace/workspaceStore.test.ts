import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspaceStore } from "./workspaceStore";
import type { WorkspaceSnapshot, ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";

describe("createWorkspaceStore", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "carrent-workspace-store-"));
  });

  it("writes and reads workspace snapshot", async () => {
    const store = createWorkspaceStore(baseDir);
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    await store.saveWorkspaceSnapshot(snapshot);
    const loaded = await store.loadWorkspaceSnapshot();
    expect(loaded).toEqual(snapshot);
  });

  it("writes and reads provider sessions", async () => {
    const store = createWorkspaceStore(baseDir);
    const snapshot: ProviderSessionSnapshot = {
      version: 1,
      sessions: { "key-1": "sess-abc" },
    };

    await store.saveProviderSessions(snapshot);
    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual(snapshot);
  });

  it("returns null for missing workspace file", async () => {
    const store = createWorkspaceStore(baseDir);
    const loaded = await store.loadWorkspaceSnapshot();
    expect(loaded).toBeNull();
  });

  it("returns empty sessions for missing provider file", async () => {
    const store = createWorkspaceStore(baseDir);
    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual({ version: 1, sessions: {} });
  });

  it("renames corrupt workspace json to corrupt backup", async () => {
    const store = createWorkspaceStore(baseDir);
    const workspacePath = join(baseDir, "workspace.json");
    await Bun.write(workspacePath, "not-json");

    const loaded = await store.loadWorkspaceSnapshot();
    expect(loaded).toBeNull();

    const files = await readdir(baseDir);
    expect(files.some((f) => f.startsWith("workspace.corrupt-"))).toBe(true);
  });

  it("renames corrupt provider sessions json to corrupt backup", async () => {
    const store = createWorkspaceStore(baseDir);
    const path = join(baseDir, "provider-sessions.json");
    await Bun.write(path, "not-json");

    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual({ version: 1, sessions: {} });

    const files = await readdir(baseDir);
    expect(files.some((f) => f.startsWith("provider-sessions.corrupt-"))).toBe(true);
  });

  it("writes atomically via temp file and rename", async () => {
    const store = createWorkspaceStore(baseDir);
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    await store.saveWorkspaceSnapshot(snapshot);
    const files = await readdir(baseDir);
    expect(files).toContain("workspace.json");
    expect(files.filter((f) => f.startsWith("workspace.json.tmp-"))).toHaveLength(0);
  });
});
