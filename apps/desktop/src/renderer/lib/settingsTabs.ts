import {
  Archive,
  Brain,
  ChartColumn,
  GitBranch,
  Monitor,
  Palette,
  SlidersHorizontal,
} from "lucide-react";

export const SETTINGS_TABS = [
  {
    id: "general",
    label: "General",
    description: "Runtime, instructions, server and updates",
  },
  {
    id: "usage",
    label: "Usage",
    description: "Kimi Code token usage",
  },
  {
    id: "memory",
    label: "Memory",
    description: "Kimi Code agent memory",
    badge: "Beta",
  },
  {
    id: "worktrees",
    label: "Worktrees",
    description: "Git worktrees across Projects",
  },
  {
    id: "interface",
    label: "Interface",
    description: "Theme and text size",
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
  usage: ChartColumn,
  memory: Brain,
  worktrees: GitBranch,
  interface: Palette,
  archives: Archive,
};

export const DEFAULT_SETTINGS_TAB_ID: SettingsTabId = "general";

// Tabs merged into General; keep old links working.
const LEGACY_GENERAL_TAB_IDS = new Set(["runtime", "personalization", "local-server", "about"]);

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
