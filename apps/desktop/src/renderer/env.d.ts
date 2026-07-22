/// <reference types="vite/client" />

import type {
  RuntimeId,
  RuntimeModelListResult,
  RuntimeRecord,
  RuntimeVerificationResult,
} from "../shared/runtimes";
import type {
  ChatTurnRequest,
  ChatRunEvent,
  DeleteThreadDataRequest,
  AttachmentMetadata,
  KimiSessionStatus,
} from "../shared/chat";
import type { ChatPermissionResponse } from "../shared/chatPermissions";
import type { SkillRecord } from "../shared/skills";
import type { McpServerStatus } from "../shared/mcpServer";
import type {
  GitBranchInfo,
  GitWorkspaceDiffResult,
  GitWorkspaceSnapshotResult,
} from "../../electron/git/gitIpc";
import type { WorkspaceSnapshot, ProviderSessionSnapshot } from "../shared/workspacePersistence";
import type { RtkGainStats } from "../shared/rtk";

declare global {
  interface Window {
    carrent: {
      platform: NodeJS.Platform;
      electronVersion: string;
      runtimes: {
        list: () => Promise<RuntimeRecord[]>;
        localCheck: (id: RuntimeId) => Promise<RuntimeVerificationResult>;
        modelPing: (id: RuntimeId) => Promise<RuntimeVerificationResult>;
        listModels: (id: RuntimeId) => Promise<RuntimeModelListResult>;
        start: (id: RuntimeId) => Promise<void>;
        stop: (id: RuntimeId) => Promise<void>;
        restart: (id: RuntimeId) => Promise<void>;
        refreshVersion: (id: RuntimeId) => Promise<RuntimeRecord>;
        startAll: () => Promise<void>;
        stopAll: () => Promise<void>;
        restartAll: () => Promise<void>;
      };
      mcpServer: {
        start: () => Promise<McpServerStatus>;
        stop: () => Promise<McpServerStatus>;
        getStatus: () => Promise<McpServerStatus>;
      };
      chat: {
        send: (request: ChatTurnRequest) => Promise<{ runId: string }>;
        stop: (runId: string) => Promise<void>;
        deleteThreadData: (request: DeleteThreadDataRequest) => Promise<void>;
        respondToPermission: (response: ChatPermissionResponse) => Promise<void>;
        getKimiStatus: (request: ChatTurnRequest) => Promise<KimiSessionStatus | null>;
        onEvent: (listener: (event: ChatRunEvent) => void) => VoidFunction;
      };
      attachments: {
        store: (input: {
          name: string;
          mimeType: string;
          data: Uint8Array;
        }) => Promise<AttachmentMetadata>;
        read: (storageKey: string) => Promise<Uint8Array>;
      };
      skills: {
        list: () => Promise<SkillRecord[]>;
      };
      dialog: {
        openDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      };
      shell: {
        openPath: (filePath: string) => Promise<string>;
      };
      clipboard: {
        writeText: (text: string) => Promise<void>;
      };
      workspace: {
        load: () => Promise<WorkspaceSnapshot | null>;
        remember: (snapshot: WorkspaceSnapshot) => void;
        save: (snapshot: WorkspaceSnapshot) => Promise<void>;
      };
      providerSessions: {
        load: () => Promise<ProviderSessionSnapshot>;
        save: (snapshot: ProviderSessionSnapshot) => Promise<void>;
      };
      settings: {
        checkForUpdates: () => Promise<{ hasUpdate: boolean; latestVersion?: string }>;
        rtkGain: () => Promise<RtkGainStats>;
        readGlobalAgentInstructions: () => Promise<{
          path: string;
          content: string;
          exists: boolean;
          maxBytes: number;
        }>;
        writeGlobalAgentInstructions: (content: string) => Promise<{
          path: string;
          content: string;
          exists: boolean;
          maxBytes: number;
        }>;
        writeGlobalRtkInstructions: (content: string) => Promise<{
          path: string;
          content: string;
        }>;
      };
      git: {
        branches: (projectPath: string) => Promise<GitBranchInfo>;
        checkout: (projectPath: string, branch: string) => Promise<GitBranchInfo>;
        createBranch: (projectPath: string, branch: string) => Promise<GitBranchInfo>;
        workspaceSnapshot: (projectPath: string) => Promise<GitWorkspaceSnapshotResult>;
        workspaceDiff: (
          projectPath: string,
          baseRevision?: string,
        ) => Promise<GitWorkspaceDiffResult>;
      };
    };
  }
}

export {};
