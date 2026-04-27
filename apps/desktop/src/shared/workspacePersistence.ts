import type { DraftThreadRecord } from "../renderer/lib/draftThreads";
import type {
  AgentRecord,
  Message,
  ProjectRecord,
  ThreadRecord,
} from "../renderer/mock/uiShellData";
import { normalizeRuntimeMode } from "./runtimeMode";

export const WORKSPACE_SNAPSHOT_VERSION = 1;

export type WorkspaceSnapshot = {
  version: typeof WORKSPACE_SNAPSHOT_VERSION;
  projects: ProjectRecord[];
  chats: ThreadRecord[];
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

  const chats = value.chats === undefined ? [] : value.chats;
  if (!Array.isArray(chats)) return null;

  const snapshot = value as WorkspaceSnapshot;
  if (snapshot.agents !== undefined && !Array.isArray(snapshot.agents)) {
    return null;
  }

  function normalizeThreadRecord<T extends { runtimeMode?: unknown }>(thread: T) {
    return {
      ...thread,
      runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
    };
  }

  return {
    ...snapshot,
    projects: snapshot.projects.map((project) => ({
      ...project,
      threads: project.threads.map(normalizeThreadRecord),
    })),
    chats: chats.map(normalizeThreadRecord),
    drafts: snapshot.drafts.map((draft) => ({
      ...draft,
      runtimeMode: normalizeRuntimeMode(draft.runtimeMode),
    })),
  };
}

export function normalizeProviderSessionSnapshot(value: unknown): ProviderSessionSnapshot | null {
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
