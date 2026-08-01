import { describe, expect, it } from "bun:test";

import {
  buildRecoveredWindowOptions,
  captureSession,
  restoreWindows,
} from "./carrentWindowSession";
import type { CapturedWindow } from "./carrentWindowSessionStore";

function capture(id: number, route: string | null, maximized = false): CapturedWindow {
  return {
    id,
    route,
    bounds: { x: id * 10, y: id * 20, width: 1280, height: 840 },
    maximized,
  };
}

describe("captureSession", () => {
  it("captures each window with route, bounds, and maximized state in activation order", () => {
    const session = captureSession(
      [capture(1, "/workspace/w-1"), capture(2, "/workspace/w-2/project/p-2", true)],
      { now: () => new Date("2026-08-01T00:00:00.000Z") },
    );

    expect(session).toEqual({
      version: 1,
      windows: [
        {
          id: 1,
          route: "/workspace/w-1",
          x: 10,
          y: 20,
          width: 1280,
          height: 840,
          maximized: false,
        },
        {
          id: 2,
          route: "/workspace/w-2/project/p-2",
          x: 20,
          y: 40,
          width: 1280,
          height: 840,
          maximized: true,
        },
      ],
      savedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("omits windows whose renderer never reported a route", () => {
    const session = captureSession(
      [capture(1, "/workspace/w-1"), capture(2, null), capture(3, "/settings")],
      { now: () => new Date(0) },
    );

    expect(session.windows.map((item) => item.id)).toEqual([1, 3]);
  });

  it("stamps savedAt with the provided clock", () => {
    const session = captureSession([capture(1, "/workspace/w-1")], {
      now: () => new Date("2026-09-02T03:04:05.000Z"),
    });
    expect(session.savedAt).toBe("2026-09-02T03:04:05.000Z");
  });

  it("produces an empty window list when every window has a null route", () => {
    const session = captureSession([capture(1, null)], { now: () => new Date(0) });
    expect(session.windows).toEqual([]);
  });
});

describe("restoreWindows", () => {
  it("returns the saved windows in their persisted order", () => {
    const session = captureSession([capture(2, "/workspace/w-2"), capture(1, "/workspace/w-1")], {
      now: () => new Date(0),
    });

    const restored = restoreWindows(session);

    expect(restored.map((item) => item.route)).toEqual(["/workspace/w-2", "/workspace/w-1"]);
  });

  it("returns an empty list when the saved session had no windows", () => {
    const session = captureSession([capture(1, null)], { now: () => new Date(0) });
    expect(restoreWindows(session)).toEqual([]);
  });

  it("keeps each restored window's bounds and maximized state", () => {
    const session = captureSession(
      [capture(1, "/workspace/w-1", true), capture(2, "/workspace/w-2", false)],
      { now: () => new Date(0) },
    );

    const restored = restoreWindows(session);

    expect(restored).toEqual([
      {
        route: "/workspace/w-1",
        bounds: { x: 10, y: 20, width: 1280, height: 840 },
        maximized: true,
      },
      {
        route: "/workspace/w-2",
        bounds: { x: 20, y: 40, width: 1280, height: 840 },
        maximized: false,
      },
    ]);
  });
});

describe("buildRecoveredWindowOptions", () => {
  const recent = {
    route: "/workspace/w-1",
    bounds: { x: 10, y: 20, width: 1280, height: 840 },
    maximized: true,
  };

  it("recovers the recent route and normal bounds for an ordinary relaunch", () => {
    expect(buildRecoveredWindowOptions(recent, null)).toEqual({
      initialPath: "/workspace/w-1",
      restoreBounds: recent.bounds,
    });
  });

  it("uses a deep-link route while retaining the recent normal bounds", () => {
    expect(buildRecoveredWindowOptions(recent, "/workspace/w-2/project/p-2/thread/t-2")).toEqual({
      initialPath: "/workspace/w-2/project/p-2/thread/t-2",
      restoreBounds: recent.bounds,
    });
  });

  it("uses only the target route when no recent window exists", () => {
    expect(buildRecoveredWindowOptions(null, "/workspace/w-2")).toEqual({
      initialPath: "/workspace/w-2",
    });
  });
});
