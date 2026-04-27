import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "system";
export type FontSize = 12 | 13 | 14 | 15 | 16;

export type Settings = {
  autoDetectRuntimes: boolean;
  theme: Theme;
  fontSize: FontSize;
};

const STORAGE_KEY = "carrent:settings";
const THEMES: Theme[] = ["dark", "light", "system"];
const FONT_SIZES: FontSize[] = [12, 13, 14, 15, 16];
const THEME_TRANSITION_CLASS = "theme-transitioning";
const THEME_TRANSITION_MS = 260;

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
    const theme = THEMES.includes(parsed.theme) ? parsed.theme : defaultSettings.theme;
    const fontSize = FONT_SIZES.includes(parsed.fontSize)
      ? parsed.fontSize
      : defaultSettings.fontSize;
    return {
      autoDetectRuntimes: parsed.autoDetectRuntimes ?? defaultSettings.autoDetectRuntimes,
      theme,
      fontSize,
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

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    finished?: Promise<unknown>;
  };
};

function applyResolvedTheme(theme: "dark" | "light", animate: boolean) {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = theme;
  };

  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }

  root.classList.add(THEME_TRANSITION_CLASS);

  const viewTransition = (document as DocumentWithViewTransition).startViewTransition?.(apply);
  const cleanup = () => root.classList.remove(THEME_TRANSITION_CLASS);

  if (viewTransition?.finished) {
    void viewTransition.finished.finally(cleanup);
  } else {
    apply();
    window.setTimeout(cleanup, THEME_TRANSITION_MS);
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const hasAppliedThemeRef = useRef(false);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  /* Apply theme to <html> */
  useEffect(() => {
    const apply = () => {
      applyResolvedTheme(resolveTheme(settings.theme), hasAppliedThemeRef.current);
      hasAppliedThemeRef.current = true;
    };
    apply();

    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings.theme]);

  /* Apply font size to <html> */
  useEffect(() => {
    document.documentElement.style.fontSize = `${settings.fontSize}px`;
  }, [settings.fontSize]);

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
