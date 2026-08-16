import type { ActionId, KeyBinding } from "../../shared/keybindings";

/**
 * Default shortcuts for every customizable action. User modifications live in
 * `AppStateSettings.keybindingOverrides`; anything absent there falls back to
 * these. The "mod" modifier is Cmd on macOS and Ctrl elsewhere.
 */
export const DEFAULT_KEYBINDINGS: Record<ActionId, KeyBinding> = {
  "search-threads": { key: "k", modifiers: ["mod"] },
  "toggle-terminal": { key: "j", modifiers: ["mod"] },
  "zoom-in": { key: "=", modifiers: ["mod"] },
  "zoom-out": { key: "-", modifiers: ["mod"] },
  "reset-zoom": { key: "0", modifiers: ["mod"] },
};
