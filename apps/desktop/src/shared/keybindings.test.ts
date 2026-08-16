import { describe, expect, it } from "bun:test";

import { ACTION_IDS, isKeyBinding } from "./keybindings";

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
  it("lists the five customizable actions", () => {
    expect(ACTION_IDS).toEqual([
      "search-threads",
      "toggle-terminal",
      "zoom-in",
      "zoom-out",
      "reset-zoom",
    ]);
  });
});
