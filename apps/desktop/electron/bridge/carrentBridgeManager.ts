import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { McpServerStatus } from "../../src/shared/mcpServer";
import { startCarrentBridge, type CarrentBridgeHandle } from "./carrentBridge";

type StartBridge = (
  options?: Parameters<typeof startCarrentBridge>[0],
) => Promise<CarrentBridgeHandle>;

export type McpServerPreferenceStore = {
  loadEnabled: () => Promise<boolean | null>;
  saveEnabled: (enabled: boolean) => Promise<void>;
};

export type CarrentBridgeManager = {
  initialize: () => Promise<McpServerStatus>;
  start: () => Promise<McpServerStatus>;
  stop: () => Promise<McpServerStatus>;
  getStatus: () => McpServerStatus;
  getHandle: () => CarrentBridgeHandle | null;
  getRuntimeHandle: () => Promise<CarrentBridgeHandle | null>;
};

export function createMcpServerPreferenceStore(baseDir: string): McpServerPreferenceStore {
  const settingsPath = join(baseDir, "mcp-server.json");

  async function atomicWrite(data: string) {
    await mkdir(baseDir, { recursive: true });
    const tmpPath = `${settingsPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, data, "utf-8");
    await rename(tmpPath, settingsPath);
  }

  return {
    async loadEnabled() {
      let raw: string;
      try {
        raw = await readFile(settingsPath, "utf-8");
      } catch {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await rename(settingsPath, join(baseDir, `mcp-server.corrupt-${Date.now()}.json`));
        return null;
      }

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as { version?: unknown }).version === 1 &&
        typeof (parsed as { enabled?: unknown }).enabled === "boolean"
      ) {
        return (parsed as { enabled: boolean }).enabled;
      }

      await rename(settingsPath, join(baseDir, `mcp-server.corrupt-${Date.now()}.json`));
      return null;
    },

    async saveEnabled(enabled) {
      await atomicWrite(JSON.stringify({ version: 1, enabled }, null, 2));
    },
  };
}

export function createCarrentBridgeManager(
  options: {
    preferenceStore?: McpServerPreferenceStore;
    startBridge?: StartBridge;
    defaultEnabled?: boolean;
    runId?: string;
  } = {},
): CarrentBridgeManager {
  const startBridge = options.startBridge ?? startCarrentBridge;
  const defaultEnabled = options.defaultEnabled ?? true;
  const runId = options.runId ?? "global";
  let enabled = defaultEnabled;
  let handle: CarrentBridgeHandle | null = null;
  let starting: Promise<CarrentBridgeHandle> | null = null;
  let lastError: string | undefined;

  function status(error?: string): McpServerStatus {
    return {
      enabled,
      running: !!handle,
      ...((error ?? lastError) ? { error: error ?? lastError } : {}),
    };
  }

  async function savePreference(nextEnabled: boolean): Promise<string | undefined> {
    try {
      await options.preferenceStore?.saveEnabled(nextEnabled);
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async function ensureStarted(): Promise<CarrentBridgeHandle | null> {
    if (!enabled) {
      return null;
    }

    if (handle) {
      lastError = undefined;
      return handle;
    }

    if (!starting) {
      lastError = undefined;
      starting = startBridge({ runId });
    }

    const inFlight = starting;
    try {
      const nextHandle = await inFlight;
      if (!enabled) {
        await nextHandle.close().catch(() => {});
        return null;
      }

      handle = nextHandle;
      lastError = undefined;
      return nextHandle;
    } catch (error) {
      lastError = errorMessage(error);
      return null;
    } finally {
      if (starting === inFlight) {
        starting = null;
      }
    }
  }

  async function closeHandle(nextHandle: CarrentBridgeHandle | null): Promise<string | undefined> {
    if (!nextHandle) {
      return undefined;
    }

    try {
      await nextHandle.close();
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  }

  return {
    async initialize() {
      try {
        const savedEnabled = await options.preferenceStore?.loadEnabled();
        enabled = savedEnabled ?? defaultEnabled;
      } catch (error) {
        lastError = errorMessage(error);
      }

      if (enabled) {
        await ensureStarted();
      }

      return status();
    },

    async start() {
      enabled = true;
      const preferenceError = await savePreference(true);
      await ensureStarted();
      return status(preferenceError);
    },

    async stop() {
      enabled = false;
      lastError = undefined;

      const preferenceError = await savePreference(false);
      const currentHandle = handle;
      handle = null;
      const closeError = await closeHandle(currentHandle);

      if (starting) {
        const inFlight = starting;
        try {
          const lateHandle = await inFlight;
          if (lateHandle !== currentHandle) {
            const lateCloseError = await closeHandle(lateHandle);
            return status(preferenceError ?? closeError ?? lateCloseError);
          }
        } catch {
          // The in-flight start already failed; stopping still leaves the server off.
        } finally {
          if (starting === inFlight) {
            starting = null;
          }
        }
      }

      return status(preferenceError ?? closeError);
    },

    getStatus() {
      return status();
    },

    getHandle() {
      return enabled ? handle : null;
    },

    async getRuntimeHandle() {
      if (!enabled) {
        return null;
      }

      const currentHandle = handle ?? (await ensureStarted());
      if (!enabled || !currentHandle) {
        return null;
      }

      return {
        mcpServer: currentHandle.mcpServer,
        async close() {
          // Kimi runs borrow the global Local MCP Server; the user-facing switch owns it.
        },
      };
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
