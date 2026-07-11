import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { CarrentBridgeHandle } from "./carrentBridge";
import {
  createCarrentBridgeManager,
  createMcpServerPreferenceStore,
  type McpServerPreferenceStore,
} from "./carrentBridgeManager";

type FakeHandle = CarrentBridgeHandle & { closed: boolean };

function createFakeHandle(id: string): FakeHandle {
  const handle: FakeHandle = {
    closed: false,
    mcpServer: {
      id: "carrent_bridge",
      name: "carrent_bridge",
      type: "http",
      url: `http://127.0.0.1/${id}/mcp?token=test`,
      headers: [],
    },
    async close() {
      handle.closed = true;
    },
  };
  return handle;
}

function createFakeStartBridge() {
  const calls: string[] = [];
  const handles: FakeHandle[] = [];

  return {
    calls,
    handles,
    async startBridge(options?: { runId?: string }) {
      const runId = options?.runId ?? "missing";
      calls.push(runId);
      const handle = createFakeHandle(runId);
      handles.push(handle);
      return handle;
    },
  };
}

function createMemoryPreferenceStore(initialEnabled: boolean | null = null) {
  let enabled = initialEnabled;
  const saves: boolean[] = [];
  const store: McpServerPreferenceStore = {
    async loadEnabled() {
      return enabled;
    },
    async saveEnabled(nextEnabled) {
      enabled = nextEnabled;
      saves.push(nextEnabled);
    },
  };

  return { store, saves };
}

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "carrent-mcp-server-"));
}

describe("createCarrentBridgeManager", () => {
  it("starts by default when no user preference exists", async () => {
    const bridge = createFakeStartBridge();
    const preferences = createMemoryPreferenceStore(null);
    const manager = createCarrentBridgeManager({
      preferenceStore: preferences.store,
      startBridge: bridge.startBridge,
    });

    expect(await manager.initialize()).toEqual({
      enabled: true,
      running: true,
    });
    expect(bridge.calls).toEqual(["global"]);
    expect(preferences.saves).toEqual([]);
  });

  it("keeps the server off when the saved preference is off", async () => {
    const bridge = createFakeStartBridge();
    const preferences = createMemoryPreferenceStore(false);
    const manager = createCarrentBridgeManager({
      preferenceStore: preferences.store,
      startBridge: bridge.startBridge,
    });

    expect(await manager.initialize()).toMatchObject({
      enabled: false,
      running: false,
    });
    expect(bridge.calls).toEqual([]);
  });

  it("persists user start and stop choices", async () => {
    const bridge = createFakeStartBridge();
    const preferences = createMemoryPreferenceStore(false);
    const manager = createCarrentBridgeManager({
      preferenceStore: preferences.store,
      startBridge: bridge.startBridge,
    });

    await manager.initialize();
    expect(await manager.start()).toMatchObject({ enabled: true, running: true });
    expect(await manager.stop()).toMatchObject({ enabled: false, running: false });

    expect(preferences.saves).toEqual([true, false]);
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("lets Kimi borrow the global server without owning shutdown", async () => {
    const bridge = createFakeStartBridge();
    const manager = createCarrentBridgeManager({ startBridge: bridge.startBridge });

    await manager.initialize();
    const runtimeHandle = await manager.getRuntimeHandle();
    await runtimeHandle?.close();

    expect(runtimeHandle?.mcpServer.url).toBe("http://127.0.0.1/global/mcp?token=test");
    expect(bridge.handles[0]?.closed).toBe(false);
    expect(manager.getStatus()).toEqual({ enabled: true, running: true });

    await manager.stop();
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("closes a late-started server if the user turns it off while starting", async () => {
    let resolveStart!: (handle: FakeHandle) => void;
    const started = new Promise<FakeHandle>((resolve) => {
      resolveStart = resolve;
    });
    const handle = createFakeHandle("slow");
    const manager = createCarrentBridgeManager({
      startBridge: async () => started,
    });

    const initialize = manager.initialize();
    await Promise.resolve();
    const stop = manager.stop();
    resolveStart(handle);

    await stop;
    await initialize;

    expect(handle.closed).toBe(true);
    expect(manager.getStatus()).toMatchObject({ enabled: false, running: false });
  });
});

describe("createMcpServerPreferenceStore", () => {
  it("writes and reads the enabled preference", async () => {
    const baseDir = await makeTempDir();
    const store = createMcpServerPreferenceStore(baseDir);

    expect(await store.loadEnabled()).toBe(null);
    await store.saveEnabled(false);
    expect(await store.loadEnabled()).toBe(false);
    await store.saveEnabled(true);
    expect(await store.loadEnabled()).toBe(true);
  });

  it("renames corrupt preference json to a backup", async () => {
    const baseDir = await makeTempDir();
    const store = createMcpServerPreferenceStore(baseDir);
    await writeFile(join(baseDir, "mcp-server.json"), "not-json", "utf-8");

    expect(await store.loadEnabled()).toBe(null);
    const files = await readdir(baseDir);
    expect(files.some((file) => file.startsWith("mcp-server.corrupt-"))).toBe(true);
  });
});
