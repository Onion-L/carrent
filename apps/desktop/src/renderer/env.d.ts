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
  ThreadDeletionTransactionRequest,
  AttachmentMetadata,
  AttachmentIntegrityMetadata,
  KimiSessionStatus,
  KimiTelemetryStatus,
  ChatRunAuthorityState,
  ChatRunAuthorityChange,
  ChatRunCommandResult,
} from "../shared/chat";
import type { ChatPermissionResponse } from "../shared/chatPermissions";
import type { ChatQuestionResponse } from "../shared/chatQuestions";
import type { SkillRecord } from "../shared/skills";
import type { McpServerStatus } from "../shared/mcpServer";
import type {
  GitBranchInfo,
  GitWorkspaceDiffResult,
  GitWorkspaceSnapshotResult,
} from "../../electron/git/gitIpc";
import type {
  AppStateSnapshot,
  ProviderSessionSnapshot,
  ProjectRelocationResult,
  ProjectRelocationRequest,
} from "../shared/workspacePersistence";
import type { RtkGainStats } from "../shared/rtk";
import type { UpdateCheckResult } from "../shared/updates";
import type { KimiMemoryIndex } from "../shared/kimiMemory";
import type {
  WorktreePruneRequest,
  WorktreePruneResult,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
  WorktreeScanResult,
  WorktreeSizeEvent,
  WorktreeSizeStartOptions,
  WorktreeSizeStartResult,
  WorktreeSizeTarget,
} from "../shared/worktrees";
import type { KimiUsageStats } from "../shared/kimiUsage";

import type { MainWindowApi } from "../shared/mainWindow";
import type { KeybindingsApi } from "../shared/keybindings";
import type { ThreadActionRequest, ThreadActionResult } from "../shared/threadActions";
import type { TerminalApi } from "../shared/terminal";
import type { BrowserApi, BrowserMenuOverlayApi } from "../shared/browser";
import type { EditorsApi } from "../shared/editors";
import type {
  AppStateAuthorityState,
  AppStateCommand,
  AppStateCommandResult,
} from "../shared/appStateAuthority";

declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    browserMenuOverlay: BrowserMenuOverlayApi;
    carrent: {
      platform: NodeJS.Platform;
      electronVersion: string;
      mainWindow: MainWindowApi;
      keybindings: KeybindingsApi;
      browser: BrowserApi;
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
        send: (request: ChatTurnRequest) => Promise<ChatRunCommandResult>;
        stop: (runId: string) => Promise<ChatRunCommandResult>;
        executeThreadAction?: (request: ThreadActionRequest) => Promise<ThreadActionResult>;
        removeRuntimeSession: (
          request: import("../shared/chat").RuntimeSessionRecovery,
        ) => Promise<void>;
        deleteThreadData: (request: DeleteThreadDataRequest) => Promise<void>;
        deleteThreadTransaction?: (request: ThreadDeletionTransactionRequest) => Promise<void>;
        respondToPermission: (response: ChatPermissionResponse) => Promise<ChatRunCommandResult>;
        respondToQuestion: (response: ChatQuestionResponse) => Promise<ChatRunCommandResult>;
        getKimiStatus: (request: ChatTurnRequest) => Promise<KimiTelemetryStatus | null>;
        getSessionStatus: (request: ChatTurnRequest) => Promise<KimiSessionStatus | null>;
        onEvent: (listener: (event: ChatRunEvent) => void) => VoidFunction;
        subscribe: () => Promise<ChatRunAuthorityState>;
        unsubscribe: () => Promise<void>;
        onChanged: (listener: (update: ChatRunAuthorityChange) => void) => VoidFunction;
      };
      attachments: {
        store: (input: {
          name: string;
          mimeType: string;
          data: Uint8Array;
        }) => Promise<AttachmentMetadata>;
        read: (metadata: AttachmentIntegrityMetadata) => Promise<Uint8Array>;
      };
      skills: {
        list: (projectDir?: string) => Promise<SkillRecord[]>;
      };
      dialog: {
        openDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      };
      shell: {
        revealPath: (
          filePath: string,
        ) => Promise<import("../shared/localPathContext").RevealPathResult>;
        openExternal: (url: string) => Promise<void>;
      };
      localPaths: {
        resolveDroppedItems: (
          files: File[],
        ) => Promise<import("../shared/localPathContext").LocalPathResolutionResult>;
      };
      editors?: EditorsApi;
      clipboard: {
        writeText: (text: string) => Promise<void>;
        readText: () => Promise<string>;
      };
      terminal: TerminalApi;
      appState: {
        load: () => Promise<import("../shared/workspacePersistence").AppStateLoadResult>;
        reread: () => Promise<import("../shared/workspacePersistence").AppStateLoadResult>;
        fullReset: () => Promise<import("../shared/workspacePersistence").AppStateLoadResult>;
        subscribe: () => Promise<AppStateAuthorityState>;
        unsubscribe: () => Promise<void>;
        command: (command: AppStateCommand) => Promise<AppStateCommandResult>;
        onChanged: (listener: (state: AppStateAuthorityState) => void) => VoidFunction;
        onFlushRequest: (listener: () => void) => VoidFunction;
        flushDone: () => Promise<void>;
      };
      providerSessions: {
        load: () => Promise<ProviderSessionSnapshot>;
        save: (snapshot: ProviderSessionSnapshot) => Promise<void>;
      };
      projectDirectories: {
        check: (workingDirectory: string) => Promise<{ available: boolean }>;
        relocate: (request: ProjectRelocationRequest) => Promise<ProjectRelocationResult>;
      };
      settings: {
        getAppVersion: () => Promise<string>;
        checkForUpdates: () => Promise<UpdateCheckResult>;
        rtkGain: () => Promise<RtkGainStats>;
        kimiUsage: () => Promise<KimiUsageStats>;
        kimiMemory: () => Promise<KimiMemoryIndex>;
        worktrees: () => Promise<WorktreeScanResult>;
        worktreesPrune: (request: WorktreePruneRequest) => Promise<WorktreePruneResult>;
        worktreesRemove: (request: WorktreeRemoveRequest) => Promise<WorktreeRemoveResult>;
        worktreeSizesStart: (
          targets: WorktreeSizeTarget[],
          options?: WorktreeSizeStartOptions,
        ) => Promise<WorktreeSizeStartResult>;
        worktreeSizesCancel: (generation: number) => Promise<void>;
        onWorktreeSizeEvent: (listener: (event: WorktreeSizeEvent) => void) => VoidFunction;
        kimiMemoryDelete: (filePath: string) => Promise<void>;
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
