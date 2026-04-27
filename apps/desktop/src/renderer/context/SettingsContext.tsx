import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "system";
export type FontSize = 12 | 13 | 14 | 15 | 16;

export type Settings = {
  autoDetectRuntimes: boolean;
  theme: Theme;
  fontSize: FontSize;
};

const STORAGE_KEY = "carrent:settings";

const defaultSettings: Settings = {
  autoDetectRuntimes: true,
  theme: "dark",
  fontSize: 14,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    return {
      autoDetectRuntimes: parsed.autoDetectRuntimes ?? defaultSettings.autoDetectRuntimes,
      theme: parsed.theme ?? defaultSettings.theme,
      fontSize: parsed.fontSize ?? defaultSettings.fontSize,
    };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

type SettingsContextValue = Settings & {
  updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
};

const SettingsContext = createContext<SettingsContextValue>({
  ...defaultSettings,
  updateSetting: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <SettingsContext.Provider value={{ ...settings, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}