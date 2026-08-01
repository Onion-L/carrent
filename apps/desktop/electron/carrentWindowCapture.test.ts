import { describe, expect, it } from "bun:test";

import { createCarrentWindowCapture, type CaptureTarget } from "./carrentWindowCapture";

type FakeWindowOptions = {
  id: number;
  destroyed?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  maximized?: boolean;
  route?: string | null;
};

function createFakeWindow({
  id,
  destroyed = false,
  bounds = { x: 10, y: 20, width: 1280, height: 840 },
  maximized = false,
  route = null,
}: FakeWindowOptions): CaptureTarget {
  return {
    id,
    isDestroyed: () => destroyed,
    getBounds: () => bounds,
    isMaximized: () => maximized,
    getRoute: () => route,
    send: () => {},
  };
}

function createCapture(targets: CaptureTarget[], timeoutMs = 100) {
  const sentRequests: number[] = [];
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMainLike = {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, listener);
    },
  };
  const capture = createCarrentWindowCapture(
    ipcMainLike,
    () => targets,
    (target) => {
      sentRequests.push(target.id);
      target.send("windows:capture-request");
    },
    timeoutMs,
  );
  return {
    capture,
    sentRequests,
    reportDone: (id: number, route: string) =>
      handlers.get("windows:capture-done")!({ sender: { id } }, route),
  };
}

describe("createCarrentWindowCapture", () => {
  it("requests the route from each window and reads bounds and maximized state", async () => {
    const targets = [
      createFakeWindow({ id: 1, bounds: { x: 0, y: 0, width: 1100, height: 700 } }),
      createFakeWindow({ id: 2, maximized: true }),
    ];
    const harness = createCapture(targets);

    const done = captureInOrder(harness, [
      { id: 1, route: "/workspace/w-1" },
      { id: 2, route: "/workspace/w-2/project/p-2" },
    ]);

    const captured = await done;

    expect(harness.sentRequests).toEqual([1, 2]);
    expect(captured).toEqual([
      {
        id: 1,
        route: "/workspace/w-1",
        bounds: { x: 0, y: 0, width: 1100, height: 700 },
        maximized: false,
      },
      {
        id: 2,
        route: "/workspace/w-2/project/p-2",
        bounds: { x: 10, y: 20, width: 1280, height: 840 },
        maximized: true,
      },
    ]);
  });

  it("uses the last known route when a window does not reply before the timeout", async () => {
    const target = createFakeWindow({ id: 1, route: "/workspace/w-1" });
    const harness = createCapture([target], 20);

    const captured = await harness.capture.capture();

    expect(captured).toEqual([
      {
        id: 1,
        route: "/workspace/w-1",
        bounds: { x: 10, y: 20, width: 1280, height: 840 },
        maximized: false,
      },
    ]);
  });

  it("skips a destroyed window entirely", async () => {
    const targets = [createFakeWindow({ id: 1, destroyed: true }), createFakeWindow({ id: 2 })];
    const harness = createCapture(targets);

    const captured = await captureInOrder(harness, [{ id: 2, route: "/workspace/w-2" }]);

    expect(harness.sentRequests).toEqual([2]);
    expect(captured.map((item) => item.id)).toEqual([2]);
  });

  it("returns an empty list when there are no live windows", async () => {
    const harness = createCapture([]);
    expect(await harness.capture.capture()).toEqual([]);
  });

  it("ignores a late capture-done reply after the timeout has resolved", async () => {
    const target = createFakeWindow({ id: 1 });
    const harness = createCapture([target], 20);

    const first = await harness.capture.capture();
    expect(first[0].route).toBe(null);

    // A late reply must not throw or mutate the already-resolved capture.
    expect(() => harness.reportDone(1, "/workspace/late")).not.toThrow();
  });

  it("keeps a null route when neither the renderer nor registry knows it", async () => {
    const harness = createCapture([createFakeWindow({ id: 1 })], 20);

    const captured = await harness.capture.capture();

    expect(captured[0].route).toBe(null);
  });
});

function captureInOrder(
  harness: ReturnType<typeof createCapture>,
  replies: Array<{ id: number; route: string }>,
) {
  const promise = harness.capture.capture();
  for (const reply of replies) harness.reportDone(reply.id, reply.route);
  return promise;
}
