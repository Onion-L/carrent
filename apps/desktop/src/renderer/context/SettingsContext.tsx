import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  DEFAULT_APP_STATE_SETTINGS,
  normalizeAppStateSettings,
  type AppStateSettings,
} from "../../shared/workspacePersistence";
import { getFontSizeCssVariables } from "../lib/fontSize";
import { useAppState } from "./AppStateContext";

export type Theme = AppStateSettings["theme"];
export type FontSize = number;

export type Settings = AppStateSettings;

// Legacy pre-snapshot location. Read once for the one-time migration and for
// the index.html boot script; new writes go to the App State snapshot.
const STORAGE_KEY = "carrent:settings";
const THEME_TRANSITION_CLASS = "theme-transitioning";
const THEME_TRANSITION_MS = 260;

function loadLegacySettings(): AppStateSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeAppStateSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

type SettingsContextValue = Settings & {
  updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
};

const SettingsContext = createContext<SettingsContextValue>({
  ...DEFAULT_APP_STATE_SETTINGS,
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
    void window.carrent?.browser?.setTheme?.(theme);
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
  const {
    hasHydrated,
    settings: persistedSettings,
    hasPersistedSettings,
    updateSettings,
  } = useAppState();
  const hasAppliedThemeRef = useRef(false);
  // Until the one-time migration lands, keep showing the legacy localStorage
  // values so the UI never flips to defaults in between.
  const legacySettingsRef = useRef<AppStateSettings | null | undefined>(undefined);
  if (legacySettingsRef.current === undefined) {
    legacySettingsRef.current = loadLegacySettings();
  }
  const settings =
    !hasPersistedSettings && legacySettingsRef.current
      ? legacySettingsRef.current
      : persistedSettings;

  /* One-time migration of localStorage settings into the App State snapshot. */
  useEffect(() => {
    if (!hasHydrated) return;
    const legacy = legacySettingsRef.current;
    if (!legacy) return;
    if (!hasPersistedSettings) {
      legacySettingsRef.current = null;
      void updateSettings(legacy).finally(() => {
        localStorage.removeItem(STORAGE_KEY);
      });
      return;
    }
    // The snapshot already carries settings; the legacy key is stale.
    legacySettingsRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
  }, [hasHydrated, hasPersistedSettings, updateSettings]);

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

  /* Apply font size without scaling rem-based layout dimensions. */
  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [property, value] of Object.entries(getFontSizeCssVariables(settings.fontSize))) {
      root.style.setProperty(property, value);
    }
  }, [settings.fontSize]);

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    void updateSettings({ ...settings, [key]: value });
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
