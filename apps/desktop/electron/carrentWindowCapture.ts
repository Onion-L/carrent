import type { WindowBounds } from "./carrentWindowGeometry";
import type { CapturedWindow } from "./carrentWindowSessionStore";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export type CaptureTarget = {
  id: number;
  isDestroyed: () => boolean;
  getBounds: () => WindowBounds;
  isMaximized: () => boolean;
  getRoute: () => string | null;
  send: (channel: string) => void;
};

function senderIdOf(event: unknown): number {
  const id = (event as { sender?: { id?: unknown } } | null)?.sender?.id;
  if (typeof id !== "number") throw new Error("Unknown window capture sender.");
  return id;
}

const DEFAULT_CAPTURE_TIMEOUT_MS = 2_000;

// Quit-time capture: asks each live Carrent Window's renderer for its current
// route, reads each window's normal bounds and maximized state directly from
// the BrowserWindow, and returns the captured windows so they can be persisted
// and restored on the next launch. Renderers that do not reply in time yield a
// null route and are omitted from the restored session.
export function createCarrentWindowCapture(
  ipcMainLike: IpcMainLike,
  getTargets: () => CaptureTarget[],
  requestCapture: (target: CaptureTarget) => void,
  timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
) {
  type Waiter = { routes: Map<number, string | null>; pending: Set<number>; resolve: () => void };
  let waiter: Waiter | null = null;

  ipcMainLike.handle("windows:capture-done", (event, route: unknown) => {
    if (!waiter) return;
    const id = senderIdOf(event);
    if (!waiter.pending.has(id)) return;
    waiter.routes.set(id, typeof route === "string" ? route : null);
    waiter.pending.delete(id);
    if (waiter.pending.size === 0) waiter.resolve();
    return undefined;
  });

  return {
    async capture(): Promise<CapturedWindow[]> {
      const targets = getTargets().filter((target) => !target.isDestroyed());
      const routes = new Map<number, string | null>();
      if (targets.length === 0) return [];

      const done = new Promise<void>((resolve) => {
        waiter = { routes, pending: new Set(targets.map((target) => target.id)), resolve };
      });
      for (const target of targets) requestCapture(target);

      await Promise.race([
        done,
        new Promise<void>((resolve) => {
          setTimeout(resolve, timeoutMs);
        }),
      ]);
      waiter = null;

      return targets.map((target) => ({
        id: target.id,
        route: routes.get(target.id) ?? target.getRoute(),
        bounds: target.getBounds(),
        maximized: target.isMaximized(),
      }));
    },
  };
}

export type CarrentWindowCapture = ReturnType<typeof createCarrentWindowCapture>;
