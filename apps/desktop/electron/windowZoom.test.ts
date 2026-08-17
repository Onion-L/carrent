import { describe, expect, it } from "bun:test";

import { createWindowZoomController, isNativeWindowZoomShortcut } from "./windowZoom";

function createWebContents(initialFactor = 1) {
  let factor = initialFactor;
  const sent: Array<[string, number]> = [];

  return {
    sent,
    webContents: {
      getZoomFactor: () => factor,
      setZoomFactor: (nextFactor: number) => {
        factor = nextFactor;
      },
      send: (channel: string, nextFactor: number) => {
        sent.push([channel, nextFactor]);
      },
      isDestroyed: () => false,
    },
  };
}

describe("createWindowZoomController", () => {
  it("moves through standard zoom percentages and resets to 100%", () => {
    const fake = createWebContents();
    const zoom = createWindowZoomController(() => fake.webContents);

    expect(zoom.change("in")).toBe(1.1);
    expect(zoom.change("in")).toBe(1.25);
    expect(zoom.change("out")).toBe(1.1);
    expect(zoom.change("reset")).toBe(1);
    expect(fake.sent).toEqual([
      ["app:zoom-changed", 1.1],
      ["app:zoom-changed", 1.25],
      ["app:zoom-changed", 1.1],
      ["app:zoom-changed", 1],
    ]);
  });

  it("preserves non-keyboard native zoom requests", () => {
    const fake = createWebContents();
    const zoom = createWindowZoomController(() => fake.webContents);
    let prevented = 0;

    zoom.handleZoomChanged({ preventDefault: () => (prevented += 1) }, "in");

    expect(prevented).toBe(1);
    expect(zoom.getFactor()).toBe(1.1);
  });
});

describe("isNativeWindowZoomShortcut", () => {
  it("recognizes the zoom accelerators owned by Electron's application menu", () => {
    const input = {
      type: "keyDown",
      key: "=",
      code: "Equal",
      control: false,
      meta: true,
    };

    expect(isNativeWindowZoomShortcut(input)).toBe(true);
    expect(isNativeWindowZoomShortcut({ ...input, key: "-", code: "Minus" })).toBe(true);
    expect(isNativeWindowZoomShortcut({ ...input, key: "0", code: "Digit0" })).toBe(true);
    expect(isNativeWindowZoomShortcut({ ...input, key: "k", code: "KeyK" })).toBe(false);
  });
});
