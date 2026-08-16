import {
  ACTION_IDS,
  type ActionId,
  type KeyBinding,
  type KeyBindingModifier,
} from "../../shared/keybindings";
import { DEFAULT_KEYBINDINGS } from "./defaultKeybindings";

// Canonical modifier order for storage and display, per the keybindings PRD.
const MODIFIER_ORDER: Record<KeyBindingModifier, number> = {
  ctrl: 0,
  alt: 1,
  shift: 2,
  mod: 3,
};

const MAC_MODIFIER_SYMBOLS: Record<KeyBindingModifier, string> = {
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  mod: "⌘",
};

const NON_MAC_MODIFIER_LABELS: Record<KeyBindingModifier, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  mod: "Ctrl",
};

// Windows display convention puts the Ctrl label first ("Ctrl+Shift+K"),
// unlike the canonical ctrl-alt-shift-mod order used for storage and Mac.
const NON_MAC_DISPLAY_ORDER: Record<KeyBindingModifier, number> = {
  mod: 0,
  ctrl: 1,
  alt: 2,
  shift: 3,
};

export type ReservedKeyLevel = "hard" | "warning";

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

/** Sorts modifiers into canonical order and drops duplicates. */
export function canonicalModifiers(modifiers: KeyBindingModifier[]): KeyBindingModifier[] {
  return [...new Set(modifiers)].sort(
    (left, right) => MODIFIER_ORDER[left] - MODIFIER_ORDER[right],
  );
}

/**
 * Effective binding for an action: the user override when one exists (an
 * explicitly-undefined entry means the binding was cleared), otherwise the
 * default.
 */
export function resolveKeybinding(
  actionId: ActionId,
  overrides?: Partial<Record<ActionId, KeyBinding>>,
): KeyBinding | undefined {
  if (overrides && actionId in overrides) return overrides[actionId];
  return DEFAULT_KEYBINDINGS[actionId];
}

/**
 * Returns the action already bound to the given combination, or null when the
 * combination is free. Compares effective bindings (defaults plus overrides);
 * `excludeActionId` (the action being recorded) never conflicts with itself.
 */
export function detectConflict(
  key: string,
  modifiers: KeyBindingModifier[],
  excludeActionId: ActionId,
  currentOverrides?: Partial<Record<ActionId, KeyBinding>>,
): ActionId | null {
  const candidateModifiers = canonicalModifiers(modifiers);
  for (const actionId of ACTION_IDS) {
    if (actionId === excludeActionId) continue;
    const binding = resolveKeybinding(actionId, currentOverrides);
    if (!binding) continue;
    if (binding.key === key && sameModifiers(binding.modifiers, candidateModifiers)) {
      return actionId;
    }
  }
  return null;
}

function sameModifiers(left: KeyBindingModifier[], right: KeyBindingModifier[]): boolean {
  const a = canonicalModifiers(left);
  const b = canonicalModifiers(right);
  return a.length === b.length && a.every((modifier, index) => modifier === b[index]);
}

/**
 * Extracts a canonical binding from a keyboard event. On Mac, metaKey maps to
 * "mod" and ctrlKey stays "ctrl"; elsewhere ctrlKey maps to "mod" and metaKey
 * has no canonical form and is dropped. `isMac` defaults to the current
 * platform so tests and callers can pin either path.
 */
export function normalizeModifiers(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  isMac = isMacPlatform(),
): KeyBinding {
  const modifiers: KeyBindingModifier[] = [];
  if (event.ctrlKey) modifiers.push(isMac ? "ctrl" : "mod");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey && isMac) modifiers.push("mod");
  return { key: event.key, modifiers: canonicalModifiers(modifiers) };
}

/**
 * Display string for a binding: Mac symbols concatenated before the key
 * ("⇧⌘K"), or plus-separated modifier names elsewhere ("Ctrl+Shift+K").
 * Single-character keys are uppercased; named keys pass through as-is.
 */
export function formatKeybinding(keybinding: KeyBinding, isMac = isMacPlatform()): string {
  const modifiers = canonicalModifiers(keybinding.modifiers);
  const display = isMac
    ? modifiers
    : [...modifiers].sort(
        (left, right) => NON_MAC_DISPLAY_ORDER[left] - NON_MAC_DISPLAY_ORDER[right],
      );
  const key = keybinding.key.length === 1 ? keybinding.key.toLocaleUpperCase() : keybinding.key;
  if (isMac) {
    return `${display.map((modifier) => MAC_MODIFIER_SYMBOLS[modifier]).join("")}${key}`;
  }
  return [...display.map((modifier) => NON_MAC_MODIFIER_LABELS[modifier]), key].join("+");
}

/**
 * OS-level shortcuts that should not be rebound. Bare Cmd+Q / Cmd+Tab are
 * hard-blocked (quit, app switcher); bare Cmd+H / Cmd+M warn but can be
 * confirmed (hide, minimize). Anything else is free to bind.
 */
export function isReservedKey(
  key: string,
  modifiers: KeyBindingModifier[],
): ReservedKeyLevel | null {
  const canonical = canonicalModifiers(modifiers);
  if (canonical.length !== 1 || canonical[0] !== "mod") return null;
  switch (key.toLocaleLowerCase()) {
    case "q":
    case "tab":
      return "hard";
    case "h":
    case "m":
      return "warning";
    default:
      return null;
  }
}
