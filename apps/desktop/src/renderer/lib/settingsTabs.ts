import {
  Archive,
  GitBranch,
  KeyRound,
  Keyboard,
  Monitor,
  Palette,
  SlidersHorizontal,
} from "lucide-react";

export const SETTINGS_TABS = [
  {
    id: "general",
    label: "General",
    description: "Instructions, project defaults and updates",
  },
  {
    id: "interface",
    label: "Interface",
    description: "Theme and text size",
  },
  {
    id: "keybindings",
    label: "Keybindings",
    description: "Customize keyboard shortcuts",
  },
  {
    id: "providers",
    label: "Providers",
    description: "API credentials, endpoints and models",
  },
  {
    id: "worktrees",
    label: "Worktrees",
    description: "Git worktrees across Projects",
  },
  {
    id: "archives",
    label: "Archived Threads",
    description: "Restore or permanently delete",
  },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const SETTINGS_TAB_ICONS: Record<SettingsTabId, typeof Monitor> = {
  general: SlidersHorizontal,
  interface: Palette,
  keybindings: Keyboard,
  providers: KeyRound,
  worktrees: GitBranch,
  archives: Archive,
};

export const DEFAULT_SETTINGS_TAB_ID: SettingsTabId = "general";

// Removed tabs redirect to General.
const LEGACY_GENERAL_TAB_IDS = new Set(["usage", "memory", "personalization", "about"]);

export function resolveSettingsTabId(value: string | null | undefined): SettingsTabId {
  if (value && LEGACY_GENERAL_TAB_IDS.has(value)) {
    return "general";
  }
  const tab = SETTINGS_TABS.find((item) => item.id === value);
  return tab?.id ?? DEFAULT_SETTINGS_TAB_ID;
}

export function buildSettingsPath(tabId: SettingsTabId): string {
  return `/settings?tab=${tabId}`;
}
