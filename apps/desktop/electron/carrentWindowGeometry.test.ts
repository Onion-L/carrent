import { describe, expect, it } from "bun:test";

import { cascadeWindowBounds, type WindowBounds } from "./carrentWindowGeometry";

const WORK_AREA: WindowBounds = { x: 0, y: 25, width: 1920, height: 1030 };

describe("cascadeWindowBounds", () => {
  it("offsets the source normal bounds down and right by the default cascade", () => {
    expect(cascadeWindowBounds({ x: 100, y: 80, width: 1280, height: 840 }, WORK_AREA)).toEqual({
      x: 124,
      y: 104,
      width: 1280,
      height: 840,
    });
  });

  it("applies a custom cascade offset", () => {
    expect(cascadeWindowBounds({ x: 100, y: 80, width: 1280, height: 840 }, WORK_AREA, 40)).toEqual(
      { x: 140, y: 120, width: 1280, height: 840 },
    );
  });

  it("clamps the offset so the new window stays inside the right edge of the work area", () => {
    const bounds = cascadeWindowBounds({ x: 1880, y: 80, width: 1280, height: 840 }, WORK_AREA);
    expect(bounds.x).toBe(WORK_AREA.x + WORK_AREA.width - 1280);
    expect(bounds.width).toBe(1280);
  });

  it("clamps the offset so the new window stays inside the bottom edge of the work area", () => {
    const bounds = cascadeWindowBounds({ x: 100, y: 980, width: 1280, height: 840 }, WORK_AREA);
    expect(bounds.y).toBe(WORK_AREA.y + WORK_AREA.height - 840);
    expect(bounds.height).toBe(840);
  });

  it("inherits the source normal width and height rather than a maximized size", () => {
    const bounds = cascadeWindowBounds({ x: 240, y: 160, width: 1100, height: 700 }, WORK_AREA);
    expect(bounds).toEqual({ x: 264, y: 184, width: 1100, height: 700 });
  });

  it("aligns to the work-area origin when the window is wider than the work area", () => {
    const narrowWorkArea: WindowBounds = { x: 0, y: 0, width: 800, height: 600 };
    const bounds = cascadeWindowBounds({ x: 100, y: 80, width: 1280, height: 840 }, narrowWorkArea);
    expect(bounds).toEqual({ x: 0, y: 0, width: 1280, height: 840 });
  });

  it("respects a work area that does not start at the origin", () => {
    const workArea: WindowBounds = { x: 1440, y: 0, width: 1920, height: 1080 };
    const bounds = cascadeWindowBounds({ x: 1500, y: 60, width: 1000, height: 700 }, workArea);
    expect(bounds).toEqual({ x: 1524, y: 84, width: 1000, height: 700 });
  });
});
