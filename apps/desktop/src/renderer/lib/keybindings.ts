import {
  ACTION_IDS,
  normalizeKeybindingInputKey,
  type ActionId,
  type EffectiveKeybindingMap,
  type KeyBinding,
  type KeyBindingModifier,
  type KeybindingScope,
} from "../../shared/keybindings";
import {
  getDefaultKeybindings,
  KEYBINDING_ACTION_BY_ID,
  type KeybindingCondition,
} from "./defaultKeybindings";

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

export type PreparedKeybindingUpdate =
  | { status: "blocked"; reason: "hard-reserved" }
  | { status: "conflict"; actionId: ActionId }
  | {
      status: "saved";
      overrides: Partial<Record<ActionId, KeyBinding | undefined>>;
    };

export function isMacPlatform(): boolean {
  if (typeof window !== "undefined" && window.carrent?.platform) {
    return window.carrent.platform === "darwin";
  }
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
  return getDefaultKeybindings(actionId, isMacPlatform())[0];
}

export function resolveKeybindings(
  actionId: ActionId,
  overrides?: Partial<Record<ActionId, KeyBinding>>,
): KeyBinding[] {
  if (overrides && actionId in overrides) {
    return overrides[actionId] ? [overrides[actionId]] : [];
  }
  return getDefaultKeybindings(actionId, isMacPlatform());
}

function conditionsOverlap(left: KeybindingCondition, right: KeybindingCondition): boolean {
  return !(
    (left === "model-picker-open" && right === "model-picker-closed") ||
    (left === "model-picker-closed" && right === "model-picker-open")
  );
}

export function keybindingScopesOverlap(left: ActionId, right: ActionId): boolean {
  const leftAction = KEYBINDING_ACTION_BY_ID[left];
  const rightAction = KEYBINDING_ACTION_BY_ID[right];
  if (!conditionsOverlap(leftAction.condition ?? "default", rightAction.condition ?? "default")) {
    return false;
  }
  const rightScopes = new Set(rightAction.scopes);
  return leftAction.scopes.some((scope) => rightScopes.has(scope));
}

export function isKeybindingActionActive(actionId: ActionId): boolean {
  const condition = KEYBINDING_ACTION_BY_ID[actionId].condition ?? "default";
  if (condition === "default") return true;
  if (typeof document === "undefined") return false;
  const modelPickerOpen = Boolean(document.querySelector('[data-model-picker-open="true"]'));
  if (condition === "model-picker-open") return modelPickerOpen;
  if (condition === "model-picker-closed") return !modelPickerOpen;
  return false;
}

export function buildEffectiveKeybindingMap(
  overrides?: Partial<Record<ActionId, KeyBinding>>,
): EffectiveKeybindingMap {
  const result: EffectiveKeybindingMap = { app: {}, terminal: {}, browser: {} };
  for (const actionId of ACTION_IDS) {
    const bindings = resolveKeybindings(actionId, overrides);
    for (const scope of KEYBINDING_ACTION_BY_ID[actionId].scopes) {
      result[scope][actionId] = bindings;
    }
  }
  return result;
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
  const candidate: KeyBinding = { key, modifiers };
  for (const actionId of ACTION_IDS) {
    if (actionId === excludeActionId) continue;
    if (!keybindingScopesOverlap(actionId, excludeActionId)) continue;
    const bindings = resolveKeybindings(actionId, currentOverrides);
    if (bindings.some((binding) => isSameBinding(binding, candidate))) {
      return actionId;
    }
  }
  return null;
}

function platformModifiers(modifiers: KeyBindingModifier[], isMac: boolean): KeyBindingModifier[] {
  return canonicalModifiers(
    isMac ? modifiers : modifiers.map((modifier) => (modifier === "ctrl" ? "mod" : modifier)),
  );
}

function sameModifiers(
  left: KeyBindingModifier[],
  right: KeyBindingModifier[],
  isMac: boolean,
): boolean {
  const a = platformModifiers(left, isMac);
  const b = platformModifiers(right, isMac);
  return a.length === b.length && a.every((modifier, index) => modifier === b[index]);
}

/**
 * The single equality rule for keybindings, shared by runtime matching
 * (useKeybinding) and conflict detection (detectConflict): keys compare
 * case-insensitively (so caps lock cannot break or hide a shortcut — shift is
 * tracked as a modifier anyway) and modifiers compare as a set in canonical
 * order.
 */
export function isSameBinding(
  left: KeyBinding,
  right: KeyBinding,
  isMac = isMacPlatform(),
): boolean {
  if (left.key.toLocaleLowerCase() !== right.key.toLocaleLowerCase()) return false;
  return sameModifiers(left.modifiers, right.modifiers, isMac);
}

export function isKeybindingRecorderTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.dataset.keybindingRecorder === "true";
}

export function isKeybindingTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !==
      null
  );
}

export function getKeybindingScope(target: EventTarget | null): KeybindingScope {
  if (!(target instanceof Element)) return "app";
  const scoped = target.closest<HTMLElement>("[data-keybinding-scope]");
  const scope = scoped?.dataset.keybindingScope;
  return scope === "terminal" || scope === "browser" ? scope : "app";
}

/**
 * Extracts a canonical binding from a keyboard event. On Mac, metaKey maps to
 * "mod" and ctrlKey stays "ctrl"; elsewhere ctrlKey maps to "mod" and metaKey
 * has no canonical form and is dropped. `isMac` defaults to the current
 * platform so tests and callers can pin either path.
 */
export function normalizeModifiers(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
    code?: string;
  },
  isMac = isMacPlatform(),
): KeyBinding {
  const modifiers: KeyBindingModifier[] = [];
  const shiftedPlus = event.key === "+" && event.code !== "NumpadAdd" && event.shiftKey;
  if (event.ctrlKey) modifiers.push(isMac ? "ctrl" : "mod");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey && !shiftedPlus) modifiers.push("shift");
  if (event.metaKey && isMac) modifiers.push("mod");
  return {
    key: normalizeKeybindingInputKey(event),
    modifiers: canonicalModifiers(modifiers),
  };
}

/**
 * Display string for a binding: Mac symbols concatenated before the key
 * ("⇧⌘K"), or plus-separated modifier names elsewhere ("Ctrl+Shift+K").
 * Single-character keys are uppercased; named keys pass through as-is.
 */
export function formatKeybinding(keybinding: KeyBinding, isMac = isMacPlatform()): string {
  const parts = getKeybindingDisplayParts(keybinding, isMac);
  return parts.join(isMac ? "" : "+");
}

export function getKeybindingDisplayParts(
  keybinding: KeyBinding,
  isMac = isMacPlatform(),
): string[] {
  const modifiers = platformModifiers(keybinding.modifiers, isMac);
  const display = isMac
    ? modifiers
    : [...modifiers].sort(
        (left, right) => NON_MAC_DISPLAY_ORDER[left] - NON_MAC_DISPLAY_ORDER[right],
      );
  const key = keybinding.key.length === 1 ? keybinding.key.toLocaleUpperCase() : keybinding.key;
  const modifierLabels = isMac
    ? display.map((modifier) => MAC_MODIFIER_SYMBOLS[modifier])
    : display.map((modifier) => NON_MAC_MODIFIER_LABELS[modifier]);
  return [...modifierLabels, key];
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

/** Final validation and immutable override update for recording confirmation. */
export function prepareKeybindingUpdate(
  actionId: ActionId,
  binding: KeyBinding | undefined,
  currentOverrides: Partial<Record<ActionId, KeyBinding>> = {},
  confirmedConflictActionId?: ActionId,
): PreparedKeybindingUpdate {
  if (binding && isReservedKey(binding.key, binding.modifiers) === "hard") {
    return { status: "blocked", reason: "hard-reserved" };
  }
  const conflict = binding
    ? detectConflict(binding.key, binding.modifiers, actionId, currentOverrides)
    : null;
  if (conflict && conflict !== confirmedConflictActionId) {
    return { status: "conflict", actionId: conflict };
  }

  const overrides: Partial<Record<ActionId, KeyBinding | undefined>> = { ...currentOverrides };
  if (conflict) overrides[conflict] = undefined;
  if (binding && isSameBinding(binding, getDefaultKeybindings(actionId, isMacPlatform())[0])) {
    delete overrides[actionId];
  } else {
    overrides[actionId] = binding;
  }
  return { status: "saved", overrides };
}

export function resetKeybindingOverride(
  actionId: ActionId,
  currentOverrides: Partial<Record<ActionId, KeyBinding>> = {},
): Partial<Record<ActionId, KeyBinding>> {
  const nextOverrides = { ...currentOverrides };
  delete nextOverrides[actionId];
  return nextOverrides;
}
