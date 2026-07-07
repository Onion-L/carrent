export const SETTINGS_TABS = [
  {
    id: "runtime",
    label: "Runtime",
    description: "Runtime status and RTK",
  },
  {
    id: "personalization",
    label: "Personalization",
    description: "Global agent instructions",
  },
  {
    id: "interface",
    label: "Interface",
    description: "Theme and text size",
  },
  {
    id: "about",
    label: "About",
    description: "Version and updates",
  },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const DEFAULT_SETTINGS_TAB_ID: SettingsTabId = "runtime";

export function resolveSettingsTabId(value: string | null | undefined): SettingsTabId {
  const tab = SETTINGS_TABS.find((item) => item.id === value);
  return tab?.id ?? DEFAULT_SETTINGS_TAB_ID;
}

export function buildSettingsPath(tabId: SettingsTabId): string {
  return `/settings?tab=${tabId}`;
}
