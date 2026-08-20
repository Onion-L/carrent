/**
 * Keybinding data model shared between the renderer (defaults, UI, hooks) and
 * the App State settings persistence. The "mod" modifier is Cmd on macOS and
 * Ctrl on other platforms; the renderer resolves it per platform.
 */
export const THREAD_JUMP_ACTION_IDS = [
  "thread-jump-1",
  "thread-jump-2",
  "thread-jump-3",
  "thread-jump-4",
  "thread-jump-5",
  "thread-jump-6",
  "thread-jump-7",
  "thread-jump-8",
  "thread-jump-9",
] as const;

export const PROVIDER_PICKER_SELECT_ACTION_IDS = [
  "provider-picker-select-1",
  "provider-picker-select-2",
  "provider-picker-select-3",
  "provider-picker-select-4",
  "provider-picker-select-5",
  "provider-picker-select-6",
  "provider-picker-select-7",
  "provider-picker-select-8",
  "provider-picker-select-9",
] as const;

export const BROWSER_LOCAL_ACTION_IDS = [
  "toggle-preview",
  "preview-new-tab",
  "preview-close-tab",
  "preview-find",
  "preview-copy-url",
  "preview-refresh",
  "preview-focus-url",
  "preview-zoom-in",
  "preview-zoom-out",
  "preview-reset-zoom",
] as const;

export type ActionId =
  | "search-threads"
  | "toggle-sidebar"
  | "toggle-terminal"
  | "toggle-right-panel"
  | "terminal-new"
  | "terminal-close"
  | "terminal-find"
  | "terminal-copy"
  | "terminal-paste"
  | "toggle-diff"
  | "toggle-preview"
  | "preview-new-tab"
  | "preview-close-tab"
  | "preview-find"
  | "preview-copy-url"
  | "preview-refresh"
  | "preview-focus-url"
  | "preview-zoom-in"
  | "preview-zoom-out"
  | "preview-reset-zoom"
  | "new-thread"
  | "new-local-thread"
  | "open-file-picker"
  | "save-composer-draft"
  | "toggle-provider-picker"
  | (typeof PROVIDER_PICKER_SELECT_ACTION_IDS)[number]
  | "open-default-editor"
  | "thread-previous"
  | "thread-next"
  | (typeof THREAD_JUMP_ACTION_IDS)[number]
  | "zoom-in"
  | "zoom-out"
  | "reset-zoom";

export type KeybindingScope = "app" | "terminal" | "browser";

export type KeyBindingModifier = "mod" | "shift" | "alt" | "ctrl";

export type KeyBinding = {
  key: string;
  modifiers: Array<KeyBindingModifier>;
};

export type KeybindingInput = {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  scope?: KeybindingScope;
  actionIds?: ActionId[];
};

export type EffectiveKeybindingMap = Record<
  KeybindingScope,
  Partial<Record<ActionId, KeyBinding[]>>
>;

export type KeybindingsApi = {
  setBindings: (bindings: EffectiveKeybindingMap) => void;
  setRecording: (active: boolean) => void;
  onInput: (listener: (input: KeybindingInput) => void) => VoidFunction;
  onShortcutInput: (listener: (input: KeybindingInput) => void) => VoidFunction;
};

export const ACTION_IDS: ActionId[] = [
  "search-threads",
  "toggle-sidebar",
  "toggle-terminal",
  "toggle-right-panel",
  "terminal-new",
  "terminal-close",
  "terminal-find",
  "terminal-copy",
  "terminal-paste",
  "toggle-diff",
  "toggle-preview",
  "preview-new-tab",
  "preview-close-tab",
  "preview-find",
  "preview-copy-url",
  "preview-refresh",
  "preview-focus-url",
  "preview-zoom-in",
  "preview-zoom-out",
  "preview-reset-zoom",
  "new-thread",
  "new-local-thread",
  "open-file-picker",
  "save-composer-draft",
  "toggle-provider-picker",
  ...PROVIDER_PICKER_SELECT_ACTION_IDS,
  "open-default-editor",
  "thread-previous",
  "thread-next",
  ...THREAD_JUMP_ACTION_IDS,
  "zoom-in",
  "zoom-out",
  "reset-zoom",
];

const BROWSER_LOCAL_ACTION_ID_SET = new Set<ActionId>(BROWSER_LOCAL_ACTION_IDS);

export function browserPopupOwnerActionIds(actionIds: ActionId[]): ActionId[] {
  return actionIds.filter((actionId) => !BROWSER_LOCAL_ACTION_ID_SET.has(actionId));
}

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

export function matchesKeybindingInput(
  binding: KeyBinding,
  input: KeybindingInput,
  isMac: boolean,
): boolean {
  const eventModifiers: KeyBindingModifier[] = [];
  const shiftedPlus = input.key === "+" && input.code !== "NumpadAdd" && input.shiftKey;
  if (input.ctrlKey) eventModifiers.push(isMac ? "ctrl" : "mod");
  if (input.altKey) eventModifiers.push("alt");
  if (input.shiftKey && !shiftedPlus) eventModifiers.push("shift");
  if (input.metaKey && isMac) eventModifiers.push("mod");

  const normalize = (modifiers: KeyBindingModifier[]) =>
    [
      ...new Set(modifiers.map((modifier) => (!isMac && modifier === "ctrl" ? "mod" : modifier))),
    ].sort();
  const inputKey = normalizeKeybindingInputKey(input);
  const left = normalize(binding.modifiers);
  const right = normalize(eventModifiers);
  return (
    binding.key.toLocaleLowerCase() === inputKey.toLocaleLowerCase() &&
    left.length === right.length &&
    left.every((modifier, index) => modifier === right[index])
  );
}

export function normalizeKeybindingInputKey(
  input: Pick<KeybindingInput, "key" | "code" | "altKey" | "shiftKey">,
): string {
  if (
    (input.key === "+" && input.code !== "NumpadAdd" && input.shiftKey) ||
    input.code === "NumpadAdd"
  ) {
    return "=";
  }
  const altLetter = input.altKey ? input.code?.match(/^Key([A-Z])$/u) : null;
  if (altLetter) return altLetter[1].toLocaleLowerCase();
  if (input.shiftKey && input.code === "BracketLeft") return "[";
  if (input.shiftKey && input.code === "BracketRight") return "]";
  return input.key;
}

export function matchingKeybindingActionIds(
  bindings: Partial<Record<ActionId, KeyBinding[]>>,
  input: KeybindingInput,
  isMac: boolean,
): ActionId[] {
  return ACTION_IDS.filter((actionId) =>
    bindings[actionId]?.some((binding) => matchesKeybindingInput(binding, input, isMac)),
  );
}
