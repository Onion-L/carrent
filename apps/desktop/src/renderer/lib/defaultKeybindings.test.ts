import { describe, expect, it } from "bun:test";

import { ACTION_IDS, isKeyBinding } from "../../shared/keybindings";
import { DEFAULT_KEYBINDINGS } from "./defaultKeybindings";

describe("DEFAULT_KEYBINDINGS", () => {
  it("defines the five default bindings", () => {
    expect(DEFAULT_KEYBINDINGS).toEqual({
      "search-threads": { key: "k", modifiers: ["mod"] },
      "toggle-terminal": { key: "j", modifiers: ["mod"] },
      "zoom-in": { key: "=", modifiers: ["mod"] },
      "zoom-out": { key: "-", modifiers: ["mod"] },
      "reset-zoom": { key: "0", modifiers: ["mod"] },
    });
  });

  it("covers every action exactly once with valid bindings", () => {
    expect(Object.keys(DEFAULT_KEYBINDINGS).sort()).toEqual([...ACTION_IDS].sort());
    for (const binding of Object.values(DEFAULT_KEYBINDINGS)) {
      expect(isKeyBinding(binding)).toBe(true);
    }
  });
});
