import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCarrentWindowSessionStore, type WindowSession } from "./carrentWindowSessionStore";

const SESSION: WindowSession = {
  version: 1,
  windows: [
    {
      id: 1,
      route: "/workspace/w-1/project/p-1/thread/t-1",
      x: 24,
      y: 48,
      width: 1280,
      height: 840,
      maximized: false,
    },
    {
      id: 2,
      route: "/workspace/w-2",
      x: 48,
      y: 72,
      width: 1100,
      height: 700,
      maximized: true,
    },
  ],
  savedAt: "2026-08-01T00:00:00.000Z",
};

describe("createCarrentWindowSessionStore", () => {
  let baseDir: string;

  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  async function createStore() {
    baseDir = await mkdtemp(join(tmpdir(), "carrent-window-session-"));
    return createCarrentWindowSessionStore(baseDir, { now: () => new Date(0) });
  }

  it("returns null when no window session file exists yet", async () => {
    const store = await createStore();
    expect(await store.load()).toBe(null);
  });

  it("round-trips a captured window session", async () => {
    const store = await createStore();
    await store.save(SESSION);
    // savedAt is stamped by the store (now = new Date(0)); the windows round-trip.
    expect(await store.load()).toEqual({ ...SESSION, savedAt: "1970-01-01T00:00:00.000Z" });
  });

  it("returns null for a malformed window session file", async () => {
    const store = await createStore();
    await mkdir(baseDir, { recursive: true });
    await writeFile(join(baseDir, "window-session.json"), "{not json", "utf-8");
    expect(await store.load()).toBe(null);
  });

  it("returns null for a structurally invalid window session", async () => {
    const store = await createStore();
    await mkdir(baseDir, { recursive: true });
    await writeFile(join(baseDir, "window-session.json"), JSON.stringify({ version: 1 }), "utf-8");
    expect(await store.load()).toBe(null);
  });

  it("returns null for an unsupported schema version", async () => {
    const store = await createStore();
    await store.save(SESSION);
    const raw = JSON.parse(
      await readFile(join(baseDir, "window-session.json"), "utf-8"),
    ) as WindowSession;
    await writeFile(
      join(baseDir, "window-session.json"),
      JSON.stringify({ ...raw, version: 99 }),
      "utf-8",
    );
    expect(await store.load()).toBe(null);
  });

  it("writes atomically so a crash never leaves a half-written file", async () => {
    const store = await createStore();
    await store.save(SESSION);
    // No leftover temp files remain after a successful write.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(baseDir);
    expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("stamps savedAt at save time so reload reflects the latest capture", async () => {
    let clock = new Date("2026-08-01T00:00:00.000Z");
    const store = createCarrentWindowSessionStore(
      await (async () => {
        baseDir = await mkdtemp(join(tmpdir(), "carrent-window-session-"));
        return baseDir;
      })(),
      { now: () => clock },
    );
    await store.save(SESSION);
    const saved = await store.load();
    expect(saved?.savedAt).toBe("2026-08-01T00:00:00.000Z");

    clock = new Date("2026-08-02T12:00:00.000Z");
    await store.save({ ...SESSION, windows: SESSION.windows.slice(0, 1) });
    const next = await store.load();
    expect(next?.savedAt).toBe("2026-08-02T12:00:00.000Z");
    expect(next?.windows).toHaveLength(1);
  });
});
