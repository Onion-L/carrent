import { describe, expect, it } from "bun:test";

import {
  ACTION_IDS,
  browserPopupOwnerActionIds,
  isKeyBinding,
  matchesKeybindingInput,
} from "./keybindings";

describe("isKeyBinding", () => {
  it("accepts a binding with a key and the mod modifier", () => {
    expect(isKeyBinding({ key: "k", modifiers: ["mod"] })).toBe(true);
  });

  it("accepts a binding with every supported modifier", () => {
    expect(isKeyBinding({ key: "k", modifiers: ["mod", "shift", "alt", "ctrl"] })).toBe(true);
  });

  it("accepts a binding without modifiers", () => {
    expect(isKeyBinding({ key: "F5", modifiers: [] })).toBe(true);
  });

  it("rejects a non-object value", () => {
    expect(isKeyBinding(null)).toBe(false);
    expect(isKeyBinding("k")).toBe(false);
  });

  it("rejects an empty or non-string key", () => {
    expect(isKeyBinding({ key: "", modifiers: ["mod"] })).toBe(false);
    expect(isKeyBinding({ key: 1, modifiers: ["mod"] })).toBe(false);
    expect(isKeyBinding({ modifiers: ["mod"] })).toBe(false);
  });

  it("rejects an unsupported modifier", () => {
    expect(isKeyBinding({ key: "k", modifiers: ["meta"] })).toBe(false);
    expect(isKeyBinding({ key: "k", modifiers: ["mod", "meta"] })).toBe(false);
  });

  it("rejects a non-array modifiers value", () => {
    expect(isKeyBinding({ key: "k", modifiers: "mod" })).toBe(false);
    expect(isKeyBinding({ key: "k" })).toBe(false);
  });
});

describe("ACTION_IDS", () => {
  it("lists each customizable action exactly once", () => {
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length);
    expect(ACTION_IDS).toHaveLength(52);
    expect(ACTION_IDS).toContain("open-file-picker");
    expect(ACTION_IDS).toContain("thread-jump-9");
    expect(ACTION_IDS).toContain("model-picker-select-9");
    expect(ACTION_IDS).toContain("preview-new-tab");
    expect(ACTION_IDS).toContain("terminal-copy");
  });
});

describe("matchesKeybindingInput", () => {
  it("matches an Alt-modified letter by its physical letter code", () => {
    expect(
      matchesKeybindingInput(
        { key: "b", modifiers: ["mod", "alt"] },
        {
          key: "∫",
          code: "KeyB",
          metaKey: true,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        true,
      ),
    ).toBe(true);
  });

  it("matches shifted bracket shortcuts using their unshifted stored key", () => {
    expect(
      matchesKeybindingInput(
        { key: "[", modifiers: ["mod", "shift"] },
        {
          key: "{",
          code: "BracketLeft",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        true,
      ),
    ).toBe(true);
  });
});

describe("browserPopupOwnerActionIds", () => {
  it("keeps global actions in the main window and leaves preview actions in the popup", () => {
    expect(
      browserPopupOwnerActionIds([
        "preview-new-tab",
        "toggle-preview",
        "toggle-sidebar",
        "thread-next",
      ]),
    ).toEqual(["toggle-sidebar", "thread-next"]);
  });
});
