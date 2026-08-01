import type { AppStateAuthority } from "./appStateAuthority";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

interface WebContentsLike {
  send: (channel: string) => void;
  isDestroyed: () => boolean;
}

const FLUSH_TIMEOUT_MS = 2_000;

function senderIdOf(event: unknown): number {
  const id = (event as { sender?: { id?: unknown } } | null)?.sender?.id;
  if (typeof id !== "number") throw new Error("Unknown App State flush sender.");
  return id;
}

// Quit-time persistence: before the app quits, every subscribed renderer is
// asked to submit its pending (debounced) App State commands; once each has
// acknowledged and the authority queue has drained, everything the user typed
// is persisted. Renderers that never acknowledge are bounded by a timeout.
export function createAppStateFlush(
  ipcMainLike: IpcMainLike,
  authority: AppStateAuthority,
  resolveWebContents: (subscriberId: number) => WebContentsLike | null,
) {
  let waiters: { pending: Set<number>; resolve: () => void } | null = null;

  ipcMainLike.handle("app-state:flush-done", (event) => {
    if (!waiters) return;
    waiters.pending.delete(senderIdOf(event));
    if (waiters.pending.size === 0) waiters.resolve();
  });

  return {
    async flush() {
      const subscriberIds = authority.getSubscriberIds().filter((id) => {
        const contents = resolveWebContents(id);
        return contents !== null && !contents.isDestroyed();
      });
      if (subscriberIds.length > 0) {
        const done = new Promise<void>((resolve) => {
          waiters = { pending: new Set(subscriberIds), resolve };
        });
        for (const id of subscriberIds) {
          resolveWebContents(id)?.send("app-state:flush-request");
        }
        await Promise.race([
          done,
          new Promise<void>((resolve) => {
            setTimeout(resolve, FLUSH_TIMEOUT_MS);
          }),
        ]);
        waiters = null;
      }
      await authority.waitForIdle();
    },
  };
}

export type AppStateFlush = ReturnType<typeof createAppStateFlush>;
