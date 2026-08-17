import { describe, expect, it } from "bun:test";

import type { ActionId, KeyBinding, KeyBindingModifier } from "../../shared/keybindings";
import {
  canonicalModifiers,
  detectConflict,
  formatKeybinding,
  isMacPlatform,
  isReservedKey,
  isSameBinding,
  normalizeModifiers,
  prepareKeybindingUpdate,
  resetKeybindingOverride,
  resolveKeybinding,
} from "./keybindings";

type StubKeyboardEvent = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

function keyboardEvent(fields: StubKeyboardEvent) {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...fields,
  };
}

describe("resolveKeybinding", () => {
  it("falls back to the default when the action has no override", () => {
    expect(resolveKeybinding("search-threads", {})).toEqual({ key: "k", modifiers: ["mod"] });
    expect(resolveKeybinding("zoom-out", undefined)).toEqual({ key: "-", modifiers: ["mod"] });
  });

  it("returns the user override when present", () => {
    expect(
      resolveKeybinding("search-threads", {
        "search-threads": { key: "p", modifiers: ["mod", "shift"] },
      }),
    ).toEqual({ key: "p", modifiers: ["mod", "shift"] });
  });

  it("returns undefined for a cleared binding", () => {
    expect(resolveKeybinding("toggle-terminal", { "toggle-terminal": undefined })).toBeUndefined();
  });

  it("ignores overrides of other actions", () => {
    expect(
      resolveKeybinding("zoom-in", { "search-threads": { key: "p", modifiers: ["mod"] } }),
    ).toEqual({ key: "=", modifiers: ["mod"] });
  });
});

describe("detectConflict", () => {
  it("returns null for an unbound combination", () => {
    expect(detectConflict("p", ["mod"], "search-threads", {})).toBeNull();
  });

  it("detects a conflict with another action's default binding", () => {
    expect(detectConflict("j", ["mod"], "search-threads", {})).toBe("toggle-terminal");
  });

  it("follows overrides instead of defaults", () => {
    const overrides: Partial<Record<ActionId, KeyBinding>> = {
      "search-threads": { key: "x", modifiers: ["mod"] },
    };
    expect(detectConflict("x", ["mod"], "toggle-terminal", overrides)).toBe("search-threads");
    // The default ⌘K is replaced, so it no longer conflicts.
    expect(detectConflict("k", ["mod"], "toggle-terminal", overrides)).toBeNull();
  });

  it("excludes the given action from the check", () => {
    expect(detectConflict("k", ["mod"], "search-threads", {})).toBeNull();
  });

  it("treats a cleared binding as unbound", () => {
    expect(
      detectConflict("j", ["mod"], "search-threads", { "toggle-terminal": undefined }),
    ).toBeNull();
  });

  it("does not conflict when modifiers differ", () => {
    expect(detectConflict("j", ["mod", "shift"], "search-threads", {})).toBeNull();
    expect(detectConflict("j", [], "search-threads", {})).toBeNull();
  });

  it("matches regardless of modifier order", () => {
    const overrides: Partial<Record<ActionId, KeyBinding>> = {
      "toggle-terminal": { key: "j", modifiers: ["shift", "mod"] },
    };
    expect(detectConflict("j", ["mod", "shift"], "search-threads", overrides)).toBe(
      "toggle-terminal",
    );
  });

  it("matches keys case-insensitively so caps lock cannot hide a conflict", () => {
    expect(detectConflict("K", ["mod"], "toggle-terminal", {})).toBe("search-threads");
  });
});

describe("normalizeModifiers", () => {
  it("translates metaKey into mod on Mac", () => {
    expect(normalizeModifiers(keyboardEvent({ key: "k", metaKey: true }), true)).toEqual({
      key: "k",
      modifiers: ["mod"],
    });
  });

  it("translates ctrlKey into mod on non-Mac platforms", () => {
    expect(normalizeModifiers(keyboardEvent({ key: "k", ctrlKey: true }), false)).toEqual({
      key: "k",
      modifiers: ["mod"],
    });
  });

  it("keeps ctrl as a distinct modifier on Mac", () => {
    expect(
      normalizeModifiers(keyboardEvent({ key: "k", metaKey: true, ctrlKey: true }), true),
    ).toEqual({ key: "k", modifiers: ["ctrl", "mod"] });
  });

  it("drops meta on non-Mac platforms where it has no canonical form", () => {
    expect(normalizeModifiers(keyboardEvent({ key: "k", metaKey: true }), false)).toEqual({
      key: "k",
      modifiers: [],
    });
  });

  it("sorts multiple modifiers into canonical order", () => {
    const event = keyboardEvent({
      key: "k",
      metaKey: true,
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    expect(normalizeModifiers(event, true)).toEqual({
      key: "k",
      modifiers: ["ctrl", "alt", "shift", "mod"],
    });
  });

  it("canonicalizes shifted plus and numpad add to the zoom-in key", () => {
    expect(
      normalizeModifiers(keyboardEvent({ key: "+", shiftKey: true, code: "Equal" }), true),
    ).toEqual({ key: "=", modifiers: [] });
    expect(normalizeModifiers(keyboardEvent({ key: "+", code: "NumpadAdd" }), true)).toEqual({
      key: "=",
      modifiers: [],
    });
  });

  it("returns no modifiers for a plain key", () => {
    expect(normalizeModifiers(keyboardEvent({ key: "9" }), true)).toEqual({
      key: "9",
      modifiers: [],
    });
  });
});

describe("formatKeybinding", () => {
  it("formats mod plus a letter with Mac symbols", () => {
    expect(formatKeybinding({ key: "k", modifiers: ["mod"] }, true)).toBe("⌘K");
  });

  it("formats multiple modifiers in canonical order on Mac", () => {
    expect(formatKeybinding({ key: "K", modifiers: ["mod", "shift"] }, true)).toBe("⇧⌘K");
    expect(formatKeybinding({ key: "k", modifiers: ["mod", "shift", "alt", "ctrl"] }, true)).toBe(
      "⌃⌥⇧⌘K",
    );
  });

  it("formats with modifier names joined by plus on non-Mac platforms", () => {
    expect(formatKeybinding({ key: "K", modifiers: ["mod", "shift"] }, false)).toBe("Ctrl+Shift+K");
    expect(formatKeybinding({ key: "j", modifiers: ["mod"] }, false)).toBe("Ctrl+J");
    expect(formatKeybinding({ key: "k", modifiers: ["mod", "alt"] }, false)).toBe("Ctrl+Alt+K");
    expect(formatKeybinding({ key: "k", modifiers: ["ctrl", "mod"] }, false)).toBe("Ctrl+K");
  });

  it("formats a binding without modifiers as the bare key", () => {
    expect(formatKeybinding({ key: "F5", modifiers: [] }, true)).toBe("F5");
    expect(formatKeybinding({ key: "F5", modifiers: [] }, false)).toBe("F5");
  });

  it("leaves multi-character keys untouched on Mac", () => {
    expect(formatKeybinding({ key: "Escape", modifiers: ["mod"] }, true)).toBe("⌘Escape");
  });
});

describe("isReservedKey", () => {
  it("hard-blocks quit and app switcher shortcuts", () => {
    expect(isReservedKey("q", ["mod"])).toBe("hard");
    expect(isReservedKey("Q", ["mod"])).toBe("hard");
    expect(isReservedKey("Tab", ["mod"])).toBe("hard");
  });

  it("warns on hide and minimize shortcuts", () => {
    expect(isReservedKey("h", ["mod"])).toBe("warning");
    expect(isReservedKey("m", ["mod"])).toBe("warning");
  });

  it("allows everything else", () => {
    expect(isReservedKey("k", ["mod"])).toBeNull();
    expect(isReservedKey("q", [])).toBeNull();
    expect(isReservedKey("q", ["mod", "shift"])).toBeNull();
    expect(isReservedKey("q", ["ctrl"])).toBeNull();
  });
});

describe("canonicalModifiers", () => {
  it("sorts modifiers into storage order and drops duplicates", () => {
    const modifiers: KeyBindingModifier[] = ["mod", "shift", "mod", "ctrl"];
    expect(canonicalModifiers(modifiers)).toEqual(["ctrl", "shift", "mod"]);
  });
});

describe("isSameBinding", () => {
  it("matches identical bindings regardless of modifier order", () => {
    expect(isSameBinding({ key: "k", modifiers: ["mod"] }, { key: "k", modifiers: ["mod"] })).toBe(
      true,
    );
    expect(
      isSameBinding(
        { key: "j", modifiers: ["shift", "mod"] },
        { key: "j", modifiers: ["mod", "shift"] },
      ),
    ).toBe(true);
  });

  it("compares keys case-insensitively so caps lock cannot break a shortcut", () => {
    expect(isSameBinding({ key: "K", modifiers: ["mod"] }, { key: "k", modifiers: ["mod"] })).toBe(
      true,
    );
  });

  it("rejects different keys or modifier sets", () => {
    expect(isSameBinding({ key: "k", modifiers: ["mod"] }, { key: "p", modifiers: ["mod"] })).toBe(
      false,
    );
    expect(
      isSameBinding({ key: "k", modifiers: ["mod"] }, { key: "k", modifiers: ["mod", "shift"] }),
    ).toBe(false);
    expect(isSameBinding({ key: "k", modifiers: [] }, { key: "k", modifiers: ["mod"] })).toBe(
      false,
    );
  });

  it("matches bindings without modifiers", () => {
    expect(isSameBinding({ key: "F5", modifiers: [] }, { key: "F5", modifiers: [] })).toBe(true);
  });

  it("treats stored ctrl as the command modifier on non-Mac platforms", () => {
    expect(
      isSameBinding({ key: "k", modifiers: ["ctrl"] }, { key: "k", modifiers: ["mod"] }, false),
    ).toBe(true);
    expect(
      isSameBinding({ key: "k", modifiers: ["ctrl"] }, { key: "k", modifiers: ["mod"] }, true),
    ).toBe(false);
  });
});

describe("isMacPlatform", () => {
  it("resolves to a boolean without throwing", () => {
    expect(typeof isMacPlatform()).toBe("boolean");
  });
});

describe("prepareKeybindingUpdate", () => {
  it("blocks hard-reserved shortcuts during final validation", () => {
    expect(prepareKeybindingUpdate("search-threads", { key: "q", modifiers: ["mod"] }, {})).toEqual(
      { status: "blocked", reason: "hard-reserved" },
    );
  });

  it("requires confirmation before replacing another action's shortcut", () => {
    expect(
      prepareKeybindingUpdate("toggle-terminal", { key: "k", modifiers: ["mod"] }, {}),
    ).toEqual({ status: "conflict", actionId: "search-threads" });
  });

  it("clears the confirmed conflicting action and saves the new shortcut", () => {
    expect(
      prepareKeybindingUpdate(
        "toggle-terminal",
        { key: "k", modifiers: ["mod"] },
        {},
        "search-threads",
      ),
    ).toEqual({
      status: "saved",
      overrides: {
        "search-threads": undefined,
        "toggle-terminal": { key: "k", modifiers: ["mod"] },
      },
    });
  });

  it("removes an override when the saved binding equals the default", () => {
    expect(
      prepareKeybindingUpdate(
        "search-threads",
        { key: "k", modifiers: ["mod"] },
        { "search-threads": { key: "p", modifiers: ["mod"] } },
      ),
    ).toEqual({ status: "saved", overrides: {} });
  });
});

describe("resetKeybindingOverride", () => {
  it("removes only the requested override without mutating the current object", () => {
    const overrides: Partial<Record<ActionId, KeyBinding>> = {
      "search-threads": undefined,
      "toggle-terminal": { key: "t", modifiers: ["mod"] },
    };

    expect(resetKeybindingOverride("search-threads", overrides)).toEqual({
      "toggle-terminal": { key: "t", modifiers: ["mod"] },
    });
    expect("search-threads" in overrides).toBe(true);
  });
});
