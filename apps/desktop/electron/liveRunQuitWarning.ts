import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

export type LiveRunQuitWarningPreferenceStore = {
  loadDisabled: () => Promise<boolean | null>;
  saveDisabled: (disabled: boolean) => Promise<void>;
};

type LiveRunQuitWarningOptions = {
  preferenceStore: LiveRunQuitWarningPreferenceStore;
  showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<Pick<MessageBoxReturnValue, "response" | "checkboxChecked">>;
  reportError?: (error: unknown) => void;
};

export function createLiveRunQuitWarningPreferenceStore(
  baseDir: string,
): LiveRunQuitWarningPreferenceStore {
  const preferencePath = join(baseDir, "quit-warning.json");

  return {
    async loadDisabled() {
      let raw: string;
      try {
        raw = await readFile(preferencePath, "utf-8");
      } catch {
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as { version?: unknown; disabled?: unknown };
        if (parsed.version === 1 && typeof parsed.disabled === "boolean") {
          return parsed.disabled;
        }
      } catch {
        // Invalid preferences are replaced on the next successful write.
      }
      return null;
    },

    async saveDisabled(disabled) {
      await mkdir(baseDir, { recursive: true });
      const temporaryPath = `${preferencePath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporaryPath, JSON.stringify({ version: 1, disabled }, null, 2), "utf-8");
      await rename(temporaryPath, preferencePath);
    },
  };
}

export function createLiveRunQuitWarning({
  preferenceStore,
  showMessageBox,
  reportError,
}: LiveRunQuitWarningOptions) {
  let disabled = false;

  return {
    async initialize() {
      try {
        disabled = (await preferenceStore.loadDisabled()) ?? false;
      } catch (error) {
        reportError?.(error);
      }
    },

    async confirmQuit() {
      if (disabled) return true;

      const result = await showMessageBox({
        type: "warning",
        title: "Quit Carrent?",
        message: "Runs are still active.",
        detail: "Quitting Carrent will cancel all active Runs.",
        buttons: ["Return to Carrent", "Cancel Runs and Quit"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        checkboxLabel: "Don't warn me again",
        checkboxChecked: false,
      });

      if (result.response !== 1) return false;

      if (result.checkboxChecked) {
        disabled = true;
        try {
          await preferenceStore.saveDisabled(true);
        } catch (error) {
          reportError?.(error);
        }
      }

      return true;
    },
  };
}
