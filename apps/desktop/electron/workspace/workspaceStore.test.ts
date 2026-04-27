import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspaceStore } from "./workspaceStore";
import type { WorkspaceSnapshot, ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "carrent-workspace-store-"));
}

describe("createWorkspaceStore", () => {
  it("writes and reads workspace snapshot", async () => {
    const baseDir = await makeTempDir();
    const store = createWorkspaceStore(baseDir);
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      chats: [],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    await store.saveWorkspaceSnapshot(snapshot);
    const loaded = await store.loadWorkspaceSnapshot();
    expect(loaded).toEqual(snapshot);
  });

  it("writes and reads provider sessions", async () => {
    const baseDir = await makeTempDir();
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
    const baseDir = await makeTempDir();
    const store = createWorkspaceStore(baseDir);
    const loaded = await store.loadWorkspaceSnapshot();
    expect(loaded).toBe(null);
  });

  it("returns empty sessions for missing provider file", async () => {
    const baseDir = await makeTempDir();
    const store = createWorkspaceStore(baseDir);
    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual({ version: 1, sessions: {} });
  });

  it("renames corrupt workspace json to corrupt backup", async () => {
    const baseDir = await makeTempDir();
    const store = createWorkspaceStore(baseDir);
    const workspacePath = join(baseDir, "workspace.json");
    await writeFile(workspacePath, "not-json", "utf-8");

    const loaded = await store.loadWorkspaceSnapshot();
    expect(loaded).toBe(null);

    const files = await readdir(baseDir);
    expect(files.some((f) => f.startsWith("workspace.corrupt-"))).toBe(true);
  });

  it("renames corrupt provider sessions json to corrupt backup", async () => {
    const baseDir = await makeTempDir();
    const store = createWorkspaceStore(baseDir);
    const path = join(baseDir, "provider-sessions.json");
    await writeFile(path, "not-json", "utf-8");

    const loaded = await store.loadProviderSessions();
    expect(loaded).toEqual({ version: 1, sessions: {} });

    const files = await readdir(baseDir);
    expect(files.some((f) => f.startsWith("provider-sessions.corrupt-"))).toBe(true);
  });

  it("writes atomically via temp file and rename", async () => {
    const baseDir = await makeTempDir();
    const store = createWorkspaceStore(baseDir);
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [],
      chats: [],
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
