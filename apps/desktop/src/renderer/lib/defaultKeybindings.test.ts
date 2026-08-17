import { describe, expect, it } from "bun:test";

import { ACTION_IDS, isKeyBinding } from "../../shared/keybindings";
import { getDefaultKeybindings, KEYBINDING_ACTIONS } from "./defaultKeybindings";

describe("default Keybindings", () => {
  it("defines the expected defaults for all supported actions", () => {
    expect(getDefaultKeybindings("toggle-sidebar", true)).toEqual([
      { key: "b", modifiers: ["mod"] },
    ]);
    expect(getDefaultKeybindings("terminal-new", true)).toEqual([{ key: "n", modifiers: ["mod"] }]);
    expect(getDefaultKeybindings("toggle-preview", true)).toEqual([
      {
        key: "j",
        modifiers: ["mod", "shift"],
      },
    ]);
    expect(getDefaultKeybindings("preview-focus-url", true)).toEqual([
      {
        key: "l",
        modifiers: ["mod"],
      },
    ]);
    expect(getDefaultKeybindings("new-thread", true)[0]).toEqual({
      key: "n",
      modifiers: ["mod"],
    });
    expect(getDefaultKeybindings("open-default-editor", true)).toEqual([
      {
        key: "o",
        modifiers: ["mod"],
      },
    ]);
  });

  it("covers every action exactly once with valid bindings", () => {
    expect(KEYBINDING_ACTIONS.map((action) => action.id).sort()).toEqual([...ACTION_IDS].sort());
    expect(KEYBINDING_ACTIONS).toHaveLength(52);
    for (const action of KEYBINDING_ACTIONS) {
      expect(action.defaultBindings.length).toBeGreaterThan(0);
      for (const binding of action.defaultBindings) expect(isKeyBinding(binding)).toBe(true);
    }
  });

  it("keeps the secondary New Thread shortcut", () => {
    expect(
      KEYBINDING_ACTIONS.find((action) => action.id === "new-thread")?.defaultBindings,
    ).toEqual([
      { key: "n", modifiers: ["mod"] },
      { key: "o", modifiers: ["mod", "shift"] },
    ]);
  });

  it("uses shell-safe Terminal defaults outside macOS", () => {
    expect(getDefaultKeybindings("terminal-find", false)).toEqual([
      { key: "f", modifiers: ["mod", "shift"] },
    ]);
    expect(getDefaultKeybindings("terminal-copy", false)).toEqual([
      { key: "c", modifiers: ["mod", "shift"] },
    ]);
    expect(getDefaultKeybindings("terminal-paste", false)).toEqual([
      { key: "v", modifiers: ["mod", "shift"] },
    ]);
  });
});
