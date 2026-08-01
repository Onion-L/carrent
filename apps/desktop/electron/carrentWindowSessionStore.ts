import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { WindowBounds } from "./carrentWindowGeometry";

// Persisted Carrent Window session. Restored on startup so a normal restart
// reopens every Carrent Window that was still open at Quit, with its route,
// normal bounds, and maximized state. History, transient pane state, PTYs, and
// terminal output are never restored.

export type WindowSessionEntry = {
  id: number;
  route: string;
  // Normal (un-maximized) bounds so a maximized window restores to its real
  // size, not the maximized dimensions.
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

export type WindowSession = {
  version: 1;
  windows: WindowSessionEntry[];
  savedAt: string;
};

const SESSION_VERSION = 1;

export { SESSION_VERSION };

type StoreOptions = {
  now?: () => Date;
};

function isWindowSessionEntry(value: unknown): value is WindowSessionEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "number" &&
    typeof entry.route === "string" &&
    ["number", "string"].includes(typeof entry.x) &&
    ["number", "string"].includes(typeof entry.y) &&
    ["number", "string"].includes(typeof entry.width) &&
    ["number", "string"].includes(typeof entry.height) &&
    typeof entry.maximized === "boolean"
  );
}

// Lenient load: a missing or unparseable session simply yields null so the app
// opens a single default window, never blocks startup, and never triggers App
// State recovery (window session is presentation chrome, not app data).
export function createCarrentWindowSessionStore(baseDir: string, options: StoreOptions = {}) {
  const sessionPath = join(baseDir, "window-session.json");
  const now = options.now ?? (() => new Date());

  return {
    async load(): Promise<WindowSession | null> {
      let raw: string;
      try {
        raw = await readFile(sessionPath, "utf-8");
      } catch {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }

      if (!parsed || typeof parsed !== "object") return null;
      const candidate = parsed as Record<string, unknown>;
      if (candidate.version !== SESSION_VERSION) return null;
      if (!Array.isArray(candidate.windows)) return null;
      const windows = candidate.windows.filter(isWindowSessionEntry) as WindowSessionEntry[];
      if (windows.length !== candidate.windows.length) return null;
      if (typeof candidate.savedAt !== "string") return null;
      return {
        version: SESSION_VERSION,
        windows: windows.map((entry) => ({
          id: entry.id,
          route: entry.route,
          x: Number(entry.x),
          y: Number(entry.y),
          width: Number(entry.width),
          height: Number(entry.height),
          maximized: entry.maximized,
        })),
        savedAt: candidate.savedAt,
      };
    },

    async save(session: WindowSession): Promise<void> {
      await mkdir(baseDir, { recursive: true });
      const payload: WindowSession = { ...session, savedAt: now().toISOString() };
      const temporaryPath = `${sessionPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf-8");
      await rename(temporaryPath, sessionPath);
    },
  };
}

export type CarrentWindowSessionStore = ReturnType<typeof createCarrentWindowSessionStore>;

// Convenience: a captured window's in-memory shape before persistence. Route is
// null when the renderer never reported its location (the window is omitted).
export type CapturedWindow = {
  id: number;
  route: string | null;
  bounds: WindowBounds;
  maximized: boolean;
};
