import { describe, expect, it } from "bun:test";

import {
  handleCarrentWindowActivation,
  registerCarrentWindowCleanup,
} from "./carrentWindowLifecycle";

describe("registerCarrentWindowCleanup", () => {
  it("uses captured ids after Electron destroys the BrowserWindow contents", () => {
    let closed: (() => void) | null = null;
    let destroyed = false;
    const cleaned: Array<{ windowId: number; contentsId: number }> = [];
    const window = {
      id: 7,
      get webContents() {
        if (destroyed) throw new TypeError("Object has been destroyed");
        return { id: 42 };
      },
      on: (_event: "closed", listener: () => void) => {
        closed = listener;
      },
    };

    registerCarrentWindowCleanup(window, (identity) => cleaned.push(identity));
    destroyed = true;

    expect(() => closed?.()).not.toThrow();
    expect(cleaned).toEqual([{ windowId: 7, contentsId: 42 }]);
  });
});

describe("handleCarrentWindowActivation", () => {
  it("recovers a Carrent Window when macOS activates with none open", () => {
    const actions: string[] = [];

    handleCarrentWindowActivation({
      windowCount: () => 0,
      createRecoveredWindow: () => actions.push("create"),
      focusMostRecent: () => actions.push("focus"),
    });

    expect(actions).toEqual(["create"]);
  });

  it("focuses the most recent Carrent Window when one remains", () => {
    const actions: string[] = [];

    handleCarrentWindowActivation({
      windowCount: () => 1,
      createRecoveredWindow: () => actions.push("create"),
      focusMostRecent: () => actions.push("focus"),
    });

    expect(actions).toEqual(["focus"]);
  });
});
