/// <reference types="vite/client" />

import type { ProviderProfileId } from "../shared/providerProfiles";
import type {
  ChatTurnRequest,
  ChatRunEvent,
  DeleteThreadDataRequest,
  ThreadDeletionTransactionRequest,
  AttachmentMetadata,
  AttachmentIntegrityMetadata,
  ChatRunAuthorityState,
  ChatRunAuthorityChange,
  ChatRunCommandResult,
} from "../shared/chat";
import type { ChatPermissionResponse } from "../shared/chatPermissions";
import type { ChatQuestionResponse } from "../shared/chatQuestions";
import type { AgentDebugChanged, AgentDebugRequest, AgentDebugTrace } from "../shared/agentDebug";
import type { SkillRecord } from "../shared/skills";
import type {
  GitBranchInfo,
  GitWorkspaceDiffResult,
  GitWorkspaceSnapshotResult,
} from "../../electron/git/gitIpc";
import type {
  AppStateSnapshot,
  ProjectRelocationResult,
  ProjectRelocationRequest,
} from "../shared/workspacePersistence";
import type { RtkGainStats } from "../shared/rtk";
import type { UpdateCheckResult } from "../shared/updates";
import type { AgentAuthView, SaveAgentAuthRequest } from "../shared/agentAuth";
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

import type { MainWindowApi } from "../shared/mainWindow";
import type { KeybindingsApi } from "../shared/keybindings";
import type { TerminalApi } from "../shared/terminal";
import type { BrowserApi, BrowserMenuOverlayApi } from "../shared/browser";
import type { EditorsApi } from "../shared/editors";
import type {
  AppStateAuthorityState,
  AppStateCommand,
  AppStateCommandResult,
} from "../shared/appStateAuthority";

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<import("./lib/localFonts").LocalFontData[]>;
  }

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
      agentAuth: {
        load: () => Promise<AgentAuthView>;
        save: (request: SaveAgentAuthRequest) => Promise<AgentAuthView>;
      };
      browser: BrowserApi;
      chat: {
        send: (request: ChatTurnRequest) => Promise<ChatRunCommandResult>;
        stop: (runId: string) => Promise<ChatRunCommandResult>;
        deleteThreadData: (request: DeleteThreadDataRequest) => Promise<void>;
        deleteThreadTransaction?: (request: ThreadDeletionTransactionRequest) => Promise<void>;
        respondToPermission: (response: ChatPermissionResponse) => Promise<ChatRunCommandResult>;
        respondToQuestion: (response: ChatQuestionResponse) => Promise<ChatRunCommandResult>;
        getDebugTrace: (request: AgentDebugRequest) => Promise<AgentDebugTrace | null>;
        onDebugChanged: (listener: (change: AgentDebugChanged) => void) => VoidFunction;
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
      projectDirectories: {
        check: (workingDirectory: string) => Promise<{ available: boolean }>;
        relocate: (request: ProjectRelocationRequest) => Promise<ProjectRelocationResult>;
        defaultBase: () => Promise<{ baseDirectory: string }>;
        createEmpty: (
          request: import("../shared/emptyProject").CreateEmptyProjectDirectoryRequest,
        ) => Promise<import("../shared/emptyProject").CreateEmptyProjectDirectoryResult>;
        removeEmpty: (workingDirectory: string) => Promise<{ removed: boolean }>;
      };
      settings: {
        getAppVersion: () => Promise<string>;
        checkForUpdates: () => Promise<UpdateCheckResult>;
        rtkGain: () => Promise<RtkGainStats>;
        worktrees: () => Promise<WorktreeScanResult>;
        worktreesPrune: (request: WorktreePruneRequest) => Promise<WorktreePruneResult>;
        worktreesRemove: (request: WorktreeRemoveRequest) => Promise<WorktreeRemoveResult>;
        worktreeSizesStart: (
          targets: WorktreeSizeTarget[],
          options?: WorktreeSizeStartOptions,
        ) => Promise<WorktreeSizeStartResult>;
        worktreeSizesCancel: (generation: number) => Promise<void>;
        onWorktreeSizeEvent: (listener: (event: WorktreeSizeEvent) => void) => VoidFunction;
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
