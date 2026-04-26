import type { DraftThreadRecord } from "../renderer/lib/draftThreads";
import type { AgentRecord, Message, ProjectRecord } from "../renderer/mock/uiShellData";

export const WORKSPACE_SNAPSHOT_VERSION = 1;

export type WorkspaceSnapshot = {
  version: typeof WORKSPACE_SNAPSHOT_VERSION;
  projects: ProjectRecord[];
  messages: Message[];
  activeThreadId: string | null;
  drafts: DraftThreadRecord[];
  agents?: AgentRecord[];
};

export type ProviderSessionSnapshot = {
  version: 1;
  sessions: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== WORKSPACE_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(value.projects)) return null;
  if (!Array.isArray(value.messages)) return null;
  if (!Array.isArray(value.drafts)) return null;
  if (typeof value.activeThreadId !== "string" && value.activeThreadId !== null) return null;

  const snapshot = value as WorkspaceSnapshot;
  if (snapshot.agents !== undefined && !Array.isArray(snapshot.agents)) {
    return null;
  }

  return snapshot;
}

export function normalizeProviderSessionSnapshot(
  value: unknown,
): ProviderSessionSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (!isRecord(value.sessions)) return null;

  const sessions: Record<string, string> = {};
  for (const [key, sessionId] of Object.entries(value.sessions)) {
    if (typeof sessionId === "string") {
      sessions[key] = sessionId;
    }
  }

  return { version: 1, sessions };
}
