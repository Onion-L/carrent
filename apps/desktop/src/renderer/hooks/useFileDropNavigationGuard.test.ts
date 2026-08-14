import { describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { installFileDropNavigationGuard } from "./useFileDropNavigationGuard";

function dispatchDrag(type: "dragover" | "drop", types: string[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types } });
  window.dispatchEvent(event);
  return event;
}

describe("installFileDropNavigationGuard", () => {
  it("cancels dragover and drop for file drags so Electron cannot navigate", () => {
    const uninstall = installFileDropNavigationGuard(window);

    expect(dispatchDrag("dragover", ["Files"]).defaultPrevented).toBe(true);
    expect(dispatchDrag("drop", ["Files"]).defaultPrevented).toBe(true);

    uninstall();
  });

  it("leaves URL, text, and web-image drags untouched", () => {
    const uninstall = installFileDropNavigationGuard(window);

    expect(dispatchDrag("dragover", ["text/uri-list"]).defaultPrevented).toBe(false);
    expect(dispatchDrag("drop", ["text/plain", "text/html"]).defaultPrevented).toBe(false);
    expect(dispatchDrag("drop", ["text/html", "Files"]).defaultPrevented).toBe(false);

    uninstall();
  });

  it("stops cancelling after uninstall", () => {
    const uninstall = installFileDropNavigationGuard(window);
    uninstall();

    expect(dispatchDrag("drop", ["Files"]).defaultPrevented).toBe(false);
  });
});
