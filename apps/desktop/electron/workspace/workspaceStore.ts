import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeProviderSessionSnapshot,
  normalizeWorkspaceSnapshot,
  type ProviderSessionSnapshot,
  type WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";

export type WorkspaceStore = {
  loadWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  saveWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => Promise<void>;
  loadProviderSessions: () => Promise<ProviderSessionSnapshot>;
  saveProviderSessions: (snapshot: ProviderSessionSnapshot) => Promise<void>;
};

export function createWorkspaceStore(baseDir: string): WorkspaceStore {
  const workspacePath = join(baseDir, "workspace.json");
  const providerSessionsPath = join(baseDir, "provider-sessions.json");

  async function atomicWrite(targetPath: string, data: string): Promise<void> {
    await mkdir(baseDir, { recursive: true });
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, data, "utf-8");
    await rename(tmpPath, targetPath);
  }

  return {
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
      await atomicWrite(workspacePath, JSON.stringify(snapshot, null, 2));
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
      await atomicWrite(providerSessionsPath, JSON.stringify(snapshot, null, 2));
    },
  };
}
