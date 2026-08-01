import { afterEach, describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  DEFAULT_APP_STATE_SETTINGS,
  type AppStateSnapshot,
} from "../../shared/workspacePersistence";
import {
  createFakeAppStateAuthority,
  type FakeAppStateAuthority,
} from "../test/fakeAppStateAuthority";
import { AppStateProvider } from "./AppStateContext";
import { SettingsProvider, useSettings } from "./SettingsContext";

const baseSnapshot: AppStateSnapshot = {
  version: 1,
  workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
  projects: [],
  associations: [],
  threads: [],
  threadDrafts: [],
  threadMessages: [],
  threadRuns: [],
  threadPromotionIntents: [],
  threadWork: {},
  lastThreadIdByWorkspace: {},
  activeWorkspaceId: "workspace-1",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let settingsValue: ReturnType<typeof useSettings> | null = null;
let authority: FakeAppStateAuthority | null = null;

function Probe() {
  settingsValue = useSettings();
  return null;
}

async function renderProviders(snapshot: AppStateSnapshot) {
  settingsValue = null;
  authority = createFakeAppStateAuthority(snapshot);
  const current = authority;
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot }),
      reread: async () => ({ status: "ready", snapshot }),
      fullReset: async () => ({ status: "ready", snapshot }),
      subscribe: current.subscribe,
      unsubscribe: current.unsubscribe,
      command: current.command,
      onChanged: current.onChanged,
      onFlushRequest: () => () => {},
      flushDone: async () => {},
    },
    projectDirectories: { check: async () => ({ available: true }) },
  } as unknown as Window["carrent"];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppStateProvider>
        <SettingsProvider>
          <Probe />
        </SettingsProvider>
      </AppStateProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  settingsValue = null;
  authority = null;
  localStorage.clear();
});

describe("SettingsContext", () => {
  it("resolves settings from the App State snapshot", async () => {
    await renderProviders({
      ...baseSnapshot,
      settings: { ...DEFAULT_APP_STATE_SETTINGS, theme: "light", fontSize: 18 },
    });

    expect(settingsValue!.theme).toBe("light");
    expect(settingsValue!.fontSize).toBe(18);
  });

  it("falls back to the defaults when the snapshot has no settings", async () => {
    await renderProviders(baseSnapshot);

    expect(settingsValue!.theme).toBe("dark");
    expect(settingsValue!.fontSize).toBe(14);
    expect(settingsValue!.autoDetectRuntimes).toBe(true);
    expect(localStorage.getItem("carrent:settings")).toBe(null);
  });

  it("persists updateSetting through the authority", async () => {
    await renderProviders(baseSnapshot);

    await act(async () => {
      settingsValue!.updateSetting("theme", "light");
    });

    expect(settingsValue!.theme).toBe("light");
    expect(authority!.getState().snapshot.settings).toMatchObject({
      ...DEFAULT_APP_STATE_SETTINGS,
      theme: "light",
    });
  });

  it("migrates legacy localStorage settings into the snapshot once", async () => {
    localStorage.setItem(
      "carrent:settings",
      JSON.stringify({
        theme: "light",
        fontSize: 20,
        terminalPanelHeight: 9999,
        autoDetectRuntimes: false,
        runtimeEnabledById: { kimi: false },
      }),
    );
    await renderProviders(baseSnapshot);

    // Legacy values are visible immediately and land in the snapshot after hydrate.
    expect(settingsValue!.theme).toBe("light");
    expect(authority!.getState().snapshot.settings).toEqual({
      ...DEFAULT_APP_STATE_SETTINGS,
      theme: "light",
      fontSize: 20,
      autoDetectRuntimes: false,
      terminalPanelHeight: 720,
      runtimeEnabledById: { kimi: false },
    });
    expect(localStorage.getItem("carrent:settings")).toBe(null);
  });

  it("drops a stale legacy key when the snapshot already carries settings", async () => {
    localStorage.setItem("carrent:settings", JSON.stringify({ theme: "light", fontSize: 20 }));
    await renderProviders({
      ...baseSnapshot,
      settings: { ...DEFAULT_APP_STATE_SETTINGS, theme: "dark", fontSize: 14 },
    });

    expect(settingsValue!.theme).toBe("dark");
    expect(authority!.getState().revision).toBe(0);
    expect(localStorage.getItem("carrent:settings")).toBe(null);
  });
});
