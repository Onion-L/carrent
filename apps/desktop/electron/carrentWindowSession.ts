import type { WindowBounds } from "./carrentWindowGeometry";
import {
  SESSION_VERSION,
  type CapturedWindow,
  type WindowSession,
  type WindowSessionEntry,
} from "./carrentWindowSessionStore";

type CaptureOptions = {
  now?: () => Date;
};

// Builds the persistable window session from the windows still open at Quit,
// ordered by activation (the caller passes them in activation order). A window
// whose renderer never reported its route is omitted: there is nothing
// meaningful to restore. The returned session records each window's *normal*
// bounds and maximized state.
export function captureSession(
  windows: CapturedWindow[],
  options: CaptureOptions = {},
): WindowSession {
  const now = options.now ?? (() => new Date());
  const entries: WindowSessionEntry[] = windows
    .filter((item): item is CapturedWindow & { route: string } => item.route !== null)
    .map((item) => ({
      id: item.id,
      route: item.route,
      x: item.bounds.x,
      y: item.bounds.y,
      width: item.bounds.width,
      height: item.bounds.height,
      maximized: item.maximized,
    }));
  return { version: SESSION_VERSION, windows: entries, savedAt: now().toISOString() };
}

export type RestoredWindow = {
  route: string;
  bounds: WindowBounds;
  maximized: boolean;
};

export type RecoveredWindowOptions = {
  initialPath?: string;
  restoreBounds?: WindowBounds;
};

export function buildRecoveredWindowOptions(
  recent: RestoredWindow | null,
  targetRoute: string | null,
): RecoveredWindowOptions {
  const initialPath = targetRoute ?? recent?.route;
  return {
    ...(initialPath ? { initialPath } : {}),
    ...(recent ? { restoreBounds: recent.bounds } : {}),
  };
}

// The ordered windows to recreate at startup. Window ids are not stable across
// restarts (they are Electron webContents ids), so only route, bounds, and
// maximized state survive. Invalid routes are resolved by the renderer's
// established nearest-valid-parent fallback.
export function restoreWindows(session: WindowSession): RestoredWindow[] {
  return session.windows.map((item) => ({
    route: item.route,
    bounds: { x: item.x, y: item.y, width: item.width, height: item.height },
    maximized: item.maximized,
  }));
}

// The most recently active saved window, for Dock activation / repeated launch
// "recent-position recovery" when no Carrent Window exists but a session does.
// Returns null when no window was saved.
export function mostRecentRestoredWindow(session: WindowSession): RestoredWindow | null {
  const restored = restoreWindows(session);
  return restored.at(-1) ?? null;
}
