import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLiveRunQuitWarning,
  createLiveRunQuitWarningPreferenceStore,
  type LiveRunQuitWarningPreferenceStore,
} from "./liveRunQuitWarning";

function createMemoryPreferenceStore(initialDisabled: boolean | null = null) {
  let disabled = initialDisabled;
  const saves: boolean[] = [];
  const store: LiveRunQuitWarningPreferenceStore = {
    async loadDisabled() {
      return disabled;
    },
    async saveDisabled(nextDisabled) {
      disabled = nextDisabled;
      saves.push(nextDisabled);
    },
  };

  return { store, saves };
}

describe("createLiveRunQuitWarning", () => {
  it("persists the checkbox after confirming and skips later warnings", async () => {
    const preferences = createMemoryPreferenceStore();
    let dialogCount = 0;
    const warning = createLiveRunQuitWarning({
      preferenceStore: preferences.store,
      showMessageBox: async (options) => {
        dialogCount += 1;
        expect(options.checkboxLabel).toBe("Don't warn me again");
        return { response: 1, checkboxChecked: true };
      },
    });
    await warning.initialize();

    expect(await warning.confirmQuit()).toBe(true);
    expect(await warning.confirmQuit()).toBe(true);
    expect(dialogCount).toBe(1);
    expect(preferences.saves).toEqual([true]);
  });

  it("does not persist the checkbox when returning to Carrent", async () => {
    const preferences = createMemoryPreferenceStore();
    let dialogCount = 0;
    const warning = createLiveRunQuitWarning({
      preferenceStore: preferences.store,
      showMessageBox: async () => {
        dialogCount += 1;
        return { response: 0, checkboxChecked: true };
      },
    });
    await warning.initialize();

    expect(await warning.confirmQuit()).toBe(false);
    expect(await warning.confirmQuit()).toBe(false);
    expect(dialogCount).toBe(2);
    expect(preferences.saves).toEqual([]);
  });

  it("skips the dialog when the saved preference disables it", async () => {
    const preferences = createMemoryPreferenceStore(true);
    const warning = createLiveRunQuitWarning({
      preferenceStore: preferences.store,
      showMessageBox: async () => {
        throw new Error("dialog should not open");
      },
    });

    await warning.initialize();

    expect(await warning.confirmQuit()).toBe(true);
  });
});

describe("createLiveRunQuitWarningPreferenceStore", () => {
  it("writes and reads the disabled preference", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "carrent-quit-warning-"));
    const store = createLiveRunQuitWarningPreferenceStore(baseDir);

    expect(await store.loadDisabled()).toBe(null);
    await store.saveDisabled(true);
    expect(await store.loadDisabled()).toBe(true);
  });
});
