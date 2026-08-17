import {
  MODEL_PICKER_SELECT_ACTION_IDS,
  THREAD_JUMP_ACTION_IDS,
  type ActionId,
  type KeyBinding,
  type KeybindingScope,
} from "../../shared/keybindings";

export type KeybindingCategory = "Navigation" | "Terminal" | "Preview" | "Chat" | "Window";
export type KeybindingCondition =
  | "default"
  | "model-picker-open"
  | "model-picker-closed"
  | "approval-open";

export type KeybindingActionDefinition = {
  id: ActionId;
  label: string;
  category: KeybindingCategory;
  defaultBindings: KeyBinding[];
  nonMacDefaultBindings?: KeyBinding[];
  scopes: KeybindingScope[];
  whenLabel: string;
  condition?: KeybindingCondition;
};

const binding = (key: string, ...modifiers: KeyBinding["modifiers"]): KeyBinding => ({
  key,
  modifiers,
});

const ALL_SCOPES: KeybindingScope[] = ["app", "terminal", "browser"];
const NON_TERMINAL_SCOPES: KeybindingScope[] = ["app", "browser"];

const threadJumpActions: KeybindingActionDefinition[] = THREAD_JUMP_ACTION_IDS.map((id, index) => ({
  id,
  label: `Jump to Thread ${index + 1}`,
  category: "Navigation",
  defaultBindings: [binding(String(index + 1), "mod")],
  scopes: ALL_SCOPES,
  whenLabel: "Model picker closed",
  condition: "model-picker-closed",
}));

const modelPickerSelectActions: KeybindingActionDefinition[] = MODEL_PICKER_SELECT_ACTION_IDS.map(
  (id, index) => ({
    id,
    label: `Select Model Picker Item ${index + 1}`,
    category: "Chat",
    defaultBindings: [binding(String(index + 1), "mod")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Model picker open",
    condition: "model-picker-open",
  }),
);

/**
 * Default shortcuts for every customizable action. User modifications live in
 * `AppStateSettings.keybindingOverrides`; anything absent there falls back to
 * these. The "mod" modifier is Cmd on macOS and Ctrl elsewhere.
 */
export const KEYBINDING_ACTIONS: KeybindingActionDefinition[] = [
  {
    id: "search-threads",
    label: "Search Threads",
    category: "Navigation",
    defaultBindings: [binding("k", "mod")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Terminal not focused",
  },
  {
    id: "toggle-sidebar",
    label: "Toggle Sidebar",
    category: "Navigation",
    defaultBindings: [binding("b", "mod")],
    scopes: ALL_SCOPES,
    whenLabel: "Always",
  },
  {
    id: "toggle-right-panel",
    label: "Toggle Right Panel",
    category: "Navigation",
    defaultBindings: [binding("b", "mod", "alt")],
    scopes: ALL_SCOPES,
    whenLabel: "Always",
  },
  {
    id: "toggle-diff",
    label: "Toggle Diff",
    category: "Navigation",
    defaultBindings: [binding("d", "mod")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Terminal not focused",
  },
  {
    id: "open-default-editor",
    label: "Open Default Editor",
    category: "Navigation",
    defaultBindings: [binding("o", "mod")],
    scopes: ALL_SCOPES,
    whenLabel: "Always",
  },
  {
    id: "thread-previous",
    label: "Previous Thread",
    category: "Navigation",
    defaultBindings: [binding("[", "mod", "shift")],
    scopes: ALL_SCOPES,
    whenLabel: "A project is open",
  },
  {
    id: "thread-next",
    label: "Next Thread",
    category: "Navigation",
    defaultBindings: [binding("]", "mod", "shift")],
    scopes: ALL_SCOPES,
    whenLabel: "A project is open",
  },
  ...threadJumpActions,
  {
    id: "toggle-terminal",
    label: "Toggle Terminal",
    category: "Terminal",
    defaultBindings: [binding("j", "mod")],
    scopes: ALL_SCOPES,
    whenLabel: "Always",
  },
  {
    id: "terminal-new",
    label: "New Terminal",
    category: "Terminal",
    defaultBindings: [binding("n", "mod")],
    scopes: ["terminal"],
    whenLabel: "Terminal focused",
  },
  {
    id: "terminal-close",
    label: "Close Terminal",
    category: "Terminal",
    defaultBindings: [binding("w", "mod")],
    scopes: ["terminal"],
    whenLabel: "Terminal focused",
  },
  {
    id: "terminal-find",
    label: "Find in Terminal",
    category: "Terminal",
    defaultBindings: [binding("f", "mod")],
    nonMacDefaultBindings: [binding("f", "mod", "shift")],
    scopes: ["terminal"],
    whenLabel: "Terminal focused",
  },
  {
    id: "terminal-copy",
    label: "Copy Terminal Selection",
    category: "Terminal",
    defaultBindings: [binding("c", "mod")],
    nonMacDefaultBindings: [binding("c", "mod", "shift")],
    scopes: ["terminal"],
    whenLabel: "Terminal focused",
  },
  {
    id: "terminal-paste",
    label: "Paste into Terminal",
    category: "Terminal",
    defaultBindings: [binding("v", "mod")],
    nonMacDefaultBindings: [binding("v", "mod", "shift")],
    scopes: ["terminal"],
    whenLabel: "Terminal focused",
  },
  {
    id: "toggle-preview",
    label: "Toggle Preview",
    category: "Preview",
    defaultBindings: [binding("j", "mod", "shift")],
    scopes: ALL_SCOPES,
    whenLabel: "Always",
  },
  {
    id: "preview-new-tab",
    label: "New Preview Tab",
    category: "Preview",
    defaultBindings: [binding("t", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-close-tab",
    label: "Close Preview Tab",
    category: "Preview",
    defaultBindings: [binding("w", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-find",
    label: "Find in Preview",
    category: "Preview",
    defaultBindings: [binding("f", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-copy-url",
    label: "Copy Preview URL",
    category: "Preview",
    defaultBindings: [binding("c", "mod", "shift")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-refresh",
    label: "Refresh Preview",
    category: "Preview",
    defaultBindings: [binding("r", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-focus-url",
    label: "Focus Preview URL",
    category: "Preview",
    defaultBindings: [binding("l", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-zoom-in",
    label: "Preview Zoom In",
    category: "Preview",
    defaultBindings: [binding("=", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-zoom-out",
    label: "Preview Zoom Out",
    category: "Preview",
    defaultBindings: [binding("-", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "preview-reset-zoom",
    label: "Reset Preview Zoom",
    category: "Preview",
    defaultBindings: [binding("0", "mod")],
    scopes: ["browser"],
    whenLabel: "Preview focused",
  },
  {
    id: "new-thread",
    label: "New Thread",
    category: "Chat",
    defaultBindings: [binding("n", "mod"), binding("o", "mod", "shift")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Terminal not focused",
  },
  {
    id: "new-local-thread",
    label: "New Local Thread",
    category: "Chat",
    defaultBindings: [binding("n", "mod", "shift")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Terminal not focused",
  },
  {
    id: "open-file-picker",
    label: "Attach Files",
    category: "Chat",
    defaultBindings: [binding("p", "mod")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Composer available",
  },
  {
    id: "save-composer-draft",
    label: "Save Composer Draft",
    category: "Chat",
    defaultBindings: [binding("s", "mod")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Composer available",
  },
  {
    id: "toggle-model-picker",
    label: "Toggle Model Picker",
    category: "Chat",
    defaultBindings: [binding("m", "mod", "shift")],
    scopes: NON_TERMINAL_SCOPES,
    whenLabel: "Terminal not focused",
  },
  ...modelPickerSelectActions,
  {
    id: "approval-allow-once",
    label: "Approve Once",
    category: "Chat",
    defaultBindings: [binding("y")],
    scopes: ["app"],
    whenLabel: "Approval request open",
    condition: "approval-open",
  },
  {
    id: "approval-allow-always",
    label: "Approve for Session",
    category: "Chat",
    defaultBindings: [binding("a")],
    scopes: ["app"],
    whenLabel: "Approval request open",
    condition: "approval-open",
  },
  {
    id: "approval-reject",
    label: "Reject Approval",
    category: "Chat",
    defaultBindings: [binding("n")],
    scopes: ["app"],
    whenLabel: "Approval request open",
    condition: "approval-open",
  },
  {
    id: "zoom-in",
    label: "Zoom In",
    category: "Window",
    defaultBindings: [binding("=", "mod")],
    scopes: ["app", "terminal"],
    whenLabel: "Preview not focused",
  },
  {
    id: "zoom-out",
    label: "Zoom Out",
    category: "Window",
    defaultBindings: [binding("-", "mod")],
    scopes: ["app", "terminal"],
    whenLabel: "Preview not focused",
  },
  {
    id: "reset-zoom",
    label: "Reset Zoom",
    category: "Window",
    defaultBindings: [binding("0", "mod")],
    scopes: ["app", "terminal"],
    whenLabel: "Preview not focused",
  },
];

export const KEYBINDING_ACTION_BY_ID = Object.fromEntries(
  KEYBINDING_ACTIONS.map((action) => [action.id, action]),
) as Record<ActionId, KeybindingActionDefinition>;

export function getDefaultKeybindings(actionId: ActionId, isMac: boolean): KeyBinding[] {
  const action = KEYBINDING_ACTION_BY_ID[actionId];
  return !isMac && action.nonMacDefaultBindings
    ? action.nonMacDefaultBindings
    : action.defaultBindings;
}
