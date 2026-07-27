import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeAppStateSnapshot,
  normalizeProviderSessionSnapshot,
  normalizeWorkspaceSnapshot,
  type AppStateSnapshot,
  type ProviderSessionSnapshot,
  type WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";

export type WorkspaceStore = {
  waitForWrites: () => Promise<void>;
  loadAppStateSnapshot: () => Promise<AppStateSnapshot | null>;
  saveAppStateSnapshot: (snapshot: AppStateSnapshot) => Promise<void>;
  loadWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  saveWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => Promise<void>;
  loadProviderSessions: () => Promise<ProviderSessionSnapshot>;
  saveProviderSessions: (snapshot: ProviderSessionSnapshot) => Promise<void>;
};

export function createWorkspaceStore(baseDir: string): WorkspaceStore {
  const appStatePath = join(baseDir, "app-state.json");
  const workspacePath = join(baseDir, "workspace.json");
  const providerSessionsPath = join(baseDir, "provider-sessions.json");
  let writeQueue = Promise.resolve();

  function enqueueWrite(write: () => Promise<void>) {
    const nextWrite = writeQueue.catch(() => {}).then(write);
    writeQueue = nextWrite.then(
      () => {},
      () => {},
    );
    return nextWrite;
  }

  async function atomicWrite(targetPath: string, data: string): Promise<void> {
    await mkdir(baseDir, { recursive: true });
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, data, "utf-8");
    await rename(tmpPath, targetPath);
  }

  return {
    waitForWrites: () => writeQueue,

    async loadAppStateSnapshot(): Promise<AppStateSnapshot | null> {
      let raw: string;
      try {
        raw = await readFile(appStatePath, "utf-8");
      } catch {
        return null;
      }

      try {
        return normalizeAppStateSnapshot(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    async saveAppStateSnapshot(snapshot: AppStateSnapshot): Promise<void> {
      const normalized = normalizeAppStateSnapshot(snapshot);
      if (!normalized) {
        throw new Error("Invalid App State snapshot.");
      }
      await enqueueWrite(() => atomicWrite(appStatePath, JSON.stringify(normalized, null, 2)));
    },

    async loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | null> {
      let raw: string;
      try {
        raw = await readFile(workspacePath, "utf-8");
      } catch {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await rename(workspacePath, `${baseDir}/workspace.corrupt-${Date.now()}.json`);
        return null;
      }

      const snapshot = normalizeWorkspaceSnapshot(parsed);
      if (!snapshot) {
        await rename(workspacePath, `${baseDir}/workspace.corrupt-${Date.now()}.json`);
      }
      return snapshot;
    },

    async saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
      const normalized = normalizeWorkspaceSnapshot(snapshot);
      if (!normalized) {
        throw new Error("Invalid workspace snapshot.");
      }
      await enqueueWrite(() => atomicWrite(workspacePath, JSON.stringify(normalized, null, 2)));
    },

    async loadProviderSessions(): Promise<ProviderSessionSnapshot> {
      let raw: string;
      try {
        raw = await readFile(providerSessionsPath, "utf-8");
      } catch {
        return { version: 1, sessions: {} };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await rename(
          providerSessionsPath,
          `${baseDir}/provider-sessions.corrupt-${Date.now()}.json`,
        );
        return { version: 1, sessions: {} };
      }

      const snapshot = normalizeProviderSessionSnapshot(parsed);
      if (!snapshot) {
        await rename(
          providerSessionsPath,
          `${baseDir}/provider-sessions.corrupt-${Date.now()}.json`,
        );
      }
      return snapshot ?? { version: 1, sessions: {} };
    },

    async saveProviderSessions(snapshot: ProviderSessionSnapshot): Promise<void> {
      await enqueueWrite(() =>
        atomicWrite(providerSessionsPath, JSON.stringify(snapshot, null, 2)),
      );
    },
  };
}
