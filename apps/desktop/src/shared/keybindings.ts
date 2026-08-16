/**
 * Keybinding data model shared between the renderer (defaults, UI, hooks) and
 * the App State settings persistence. The "mod" modifier is Cmd on macOS and
 * Ctrl on other platforms; the renderer resolves it per platform.
 */
export type ActionId = "search-threads" | "toggle-terminal" | "zoom-in" | "zoom-out" | "reset-zoom";

export type KeyBindingModifier = "mod" | "shift" | "alt" | "ctrl";

export type KeyBinding = {
  key: string;
  modifiers: Array<KeyBindingModifier>;
};

export const ACTION_IDS: ActionId[] = [
  "search-threads",
  "toggle-terminal",
  "zoom-in",
  "zoom-out",
  "reset-zoom",
];

const KEY_BINDING_MODIFIERS = new Set<string>(["mod", "shift", "alt", "ctrl"]);

export function isKeyBinding(value: unknown): value is KeyBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.key !== "string" || !record.key) return false;
  if (!Array.isArray(record.modifiers)) return false;
  return record.modifiers.every(
    (modifier) => typeof modifier === "string" && KEY_BINDING_MODIFIERS.has(modifier),
  );
}
