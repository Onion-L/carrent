import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
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
} from "../src/shared/chat";
import type { ChatPermissionResponse } from "../src/shared/chatPermissions";
import type { ChatQuestionResponse } from "../src/shared/chatQuestions";
import type { SkillRecord } from "../src/shared/skills";
import type { McpServerStatus } from "../src/shared/mcpServer";
import type {
  AppStateLoadResult,
  ProviderSessionSnapshot,
  ProjectRelocationResult,
  ProjectRelocationRequest,
} from "../src/shared/workspacePersistence";
import type {
  AppStateAuthorityState,
  AppStateCommand,
  AppStateCommandResult,
} from "../src/shared/appStateAuthority";
import type { RuntimeId } from "../src/shared/runtimes";
import type {
  GitBranchInfo,
  GitWorkspaceDiffResult,
  GitWorkspaceSnapshotResult,
} from "./git/gitIpc";
import type { RtkGainStats } from "../src/shared/rtk";
import type { MainWindowApi, MainWindowZoomAction } from "../src/shared/mainWindow";
import type { ThreadActionRequest, ThreadActionResult } from "../src/shared/threadActions";
import type {
  CreateTerminalRequest,
  TerminalEvent,
  TerminalFocusRequest,
  TerminalProjectSnapshot,
  TerminalResizeRequest,
  TerminalTab,
  TerminalTarget,
  TerminalWriteRequest,
} from "../src/shared/terminal";

const mainWindow: MainWindowApi = {
  onNavigate: (listener) => {
    const wrapped = (_event: IpcRendererEvent, path: string) => listener(path);
    ipcRenderer.on("app:navigate", wrapped);
    ipcRenderer.send("app:navigation-ready");
    return () => ipcRenderer.removeListener("app:navigate", wrapped);
  },
  zoom: {
    getFactor: () => ipcRenderer.invoke("app:zoom:get") as Promise<number>,
    change: (action: MainWindowZoomAction) =>
      ipcRenderer.invoke("app:zoom:change", action) as Promise<number>,
    onFactorChange: (listener) => {
      const wrapped = (_event: IpcRendererEvent, factor: number) => listener(factor);
      ipcRenderer.on("app:zoom-changed", wrapped);
      return () => ipcRenderer.removeListener("app:zoom-changed", wrapped);
    },
  },
  windows: {
    openThread: (route: string) =>
      ipcRenderer.invoke("windows:open-thread", route) as Promise<void>,
    onOpenError: (listener) => {
      const wrapped = (_event: IpcRendererEvent, message: string) => listener(message);
      ipcRenderer.on("windows:open-error", wrapped);
      return () => ipcRenderer.removeListener("windows:open-error", wrapped);
    },
    reportRoute: (route: string) => ipcRenderer.send("windows:route-changed", route),
    onCaptureRequest: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on("windows:capture-request", wrapped);
      return () => ipcRenderer.removeListener("windows:capture-request", wrapped);
    },
    captureDone: (route: string) =>
      ipcRenderer.invoke("windows:capture-done", route) as Promise<void>,
  },
};

const carrent = {
  platform: process.platform,
  electronVersion: process.versions.electron,
  mainWindow,
  runtimes: {
    list: () => ipcRenderer.invoke("runtimes:list"),
    localCheck: (id: RuntimeId) => ipcRenderer.invoke("runtimes:local-check", id),
    modelPing: (id: RuntimeId) => ipcRenderer.invoke("runtimes:model-ping", id),
    listModels: (id: RuntimeId) => ipcRenderer.invoke("runtimes:list-models", id),
    start: (id: RuntimeId) => ipcRenderer.invoke("runtimes:start", id),
    stop: (id: RuntimeId) => ipcRenderer.invoke("runtimes:stop", id),
    restart: (id: RuntimeId) => ipcRenderer.invoke("runtimes:restart", id),
    refreshVersion: (id: RuntimeId) => ipcRenderer.invoke("runtimes:refresh-version", id),
    startAll: () => ipcRenderer.invoke("runtimes:start-all"),
    stopAll: () => ipcRenderer.invoke("runtimes:stop-all"),
    restartAll: () => ipcRenderer.invoke("runtimes:restart-all"),
  },
  mcpServer: {
    start: () => ipcRenderer.invoke("mcp-server:start") as Promise<McpServerStatus>,
    stop: () => ipcRenderer.invoke("mcp-server:stop") as Promise<McpServerStatus>,
    getStatus: () => ipcRenderer.invoke("mcp-server:status") as Promise<McpServerStatus>,
  },
  chat: {
    send: (request: ChatTurnRequest) =>
      ipcRenderer.invoke("chat:send", request) as Promise<ChatRunCommandResult>,
    stop: (runId: string) =>
      ipcRenderer.invoke("chat:stop", runId) as Promise<ChatRunCommandResult>,
    executeThreadAction: (request: ThreadActionRequest) =>
      ipcRenderer.invoke("chat:thread-action", request) as Promise<ThreadActionResult>,
    removeRuntimeSession: (request: import("../src/shared/chat").RuntimeSessionRecovery) =>
      ipcRenderer.invoke("chat:remove-runtime-session", request) as Promise<void>,
    deleteThreadData: (request: DeleteThreadDataRequest) =>
      ipcRenderer.invoke("chat:delete-thread-data", request) as Promise<void>,
    deleteThreadTransaction: (request: ThreadDeletionTransactionRequest) =>
      ipcRenderer.invoke("chat:delete-thread-transaction", request) as Promise<void>,
    respondToPermission: (response: ChatPermissionResponse) =>
      ipcRenderer.invoke("chat:permission-response", response) as Promise<ChatRunCommandResult>,
    respondToQuestion: (response: ChatQuestionResponse) =>
      ipcRenderer.invoke("chat:question-response", response) as Promise<ChatRunCommandResult>,
    getKimiStatus: (request: ChatTurnRequest) =>
      ipcRenderer.invoke("chat:kimi-status", request) as Promise<
        import("../src/shared/chat").KimiSessionStatus | null
      >,
    getSessionStatus: (request: ChatTurnRequest) =>
      ipcRenderer.invoke("chat:session-status", request) as Promise<
        import("../src/shared/chat").KimiSessionStatus | null
      >,
    onEvent: (listener: (event: ChatRunEvent) => void) => {
      const wrapped = (_event: IpcRendererEvent, evt: ChatRunEvent) => listener(evt);
      ipcRenderer.on("chat:event", wrapped);
      return () => ipcRenderer.removeListener("chat:event", wrapped);
    },
    subscribe: () => ipcRenderer.invoke("chat:subscribe") as Promise<ChatRunAuthorityState>,
    unsubscribe: () => ipcRenderer.invoke("chat:unsubscribe") as Promise<void>,
    onChanged: (listener: (update: ChatRunAuthorityChange) => void) => {
      const wrapped = (_event: IpcRendererEvent, update: ChatRunAuthorityChange) =>
        listener(update);
      ipcRenderer.on("chat:changed", wrapped);
      return () => ipcRenderer.removeListener("chat:changed", wrapped);
    },
  },
  attachments: {
    store: (input: { name: string; mimeType: string; data: Uint8Array }) =>
      ipcRenderer.invoke("attachments:store", input) as Promise<AttachmentMetadata>,
    read: (metadata: AttachmentIntegrityMetadata) =>
      ipcRenderer.invoke("attachments:read", metadata) as Promise<Uint8Array>,
  },
  skills: {
    list: () => ipcRenderer.invoke("skills:list") as Promise<SkillRecord[]>,
  },
  dialog: {
    openDirectory: () =>
      ipcRenderer.invoke("dialog:open-directory") as Promise<{
        canceled: boolean;
        filePaths: string[];
      }>,
  },
  shell: {
    openPath: (filePath: string) =>
      ipcRenderer.invoke("shell:open-path", filePath) as Promise<string>,
    revealPath: (filePath: string) =>
      ipcRenderer.invoke("shell:reveal-path", filePath) as Promise<void>,
    openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url) as Promise<void>,
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke("clipboard:write-text", text),
    readText: () => ipcRenderer.invoke("clipboard:read-text") as Promise<string>,
  },
  terminal: {
    subscribe: (projectId: string) =>
      ipcRenderer.invoke("terminal:subscribe", projectId) as Promise<TerminalProjectSnapshot>,
    unsubscribe: (projectId: string) =>
      ipcRenderer.invoke("terminal:unsubscribe", projectId) as Promise<void>,
    create: (request: CreateTerminalRequest) =>
      ipcRenderer.invoke("terminal:create", request) as Promise<TerminalTab>,
    write: (request: TerminalWriteRequest) =>
      ipcRenderer.invoke("terminal:write", request) as Promise<void>,
    resize: (request: TerminalResizeRequest) =>
      ipcRenderer.invoke("terminal:resize", request) as Promise<void>,
    focus: (request: TerminalFocusRequest) =>
      ipcRenderer.invoke("terminal:focus", request) as Promise<void>,
    activate: (request: TerminalTarget) =>
      ipcRenderer.invoke("terminal:activate", request) as Promise<void>,
    close: (request: TerminalTarget) =>
      ipcRenderer.invoke("terminal:close", request) as Promise<void>,
    closeProject: (projectId: string) =>
      ipcRenderer.invoke("terminal:close-project", projectId) as Promise<void>,
    onEvent: (listener: (event: TerminalEvent) => void) => {
      const wrapped = (_event: IpcRendererEvent, value: TerminalEvent) => listener(value);
      ipcRenderer.on("terminal:event", wrapped);
      return () => ipcRenderer.removeListener("terminal:event", wrapped);
    },
  },
  appState: {
    load: () => ipcRenderer.invoke("app-state:load") as Promise<AppStateLoadResult>,
    reread: () => ipcRenderer.invoke("app-state:reread") as Promise<AppStateLoadResult>,
    fullReset: () => ipcRenderer.invoke("app-state:full-reset") as Promise<AppStateLoadResult>,
    subscribe: () => ipcRenderer.invoke("app-state:subscribe") as Promise<AppStateAuthorityState>,
    unsubscribe: () => ipcRenderer.invoke("app-state:unsubscribe") as Promise<void>,
    command: (command: AppStateCommand) =>
      ipcRenderer.invoke("app-state:command", command) as Promise<AppStateCommandResult>,
    onChanged: (listener: (state: AppStateAuthorityState) => void) => {
      const wrapped = (_event: IpcRendererEvent, state: AppStateAuthorityState) => listener(state);
      ipcRenderer.on("app-state:changed", wrapped);
      return () => ipcRenderer.removeListener("app-state:changed", wrapped);
    },
    onFlushRequest: (listener: () => void) => {
      const wrapped = () => listener();
      ipcRenderer.on("app-state:flush-request", wrapped);
      return () => ipcRenderer.removeListener("app-state:flush-request", wrapped);
    },
    flushDone: () => ipcRenderer.invoke("app-state:flush-done") as Promise<void>,
  },
  providerSessions: {
    load: () => ipcRenderer.invoke("provider-sessions:load") as Promise<ProviderSessionSnapshot>,
    save: (snapshot: ProviderSessionSnapshot) =>
      ipcRenderer.invoke("provider-sessions:save", snapshot),
  },
  projectDirectories: {
    check: (workingDirectory: string) =>
      ipcRenderer.invoke("project-directory:check", workingDirectory) as Promise<{
        available: boolean;
      }>,
    relocate: (request: ProjectRelocationRequest) =>
      ipcRenderer.invoke("project-directory:relocate", request) as Promise<ProjectRelocationResult>,
  },
  settings: {
    checkForUpdates: () =>
      ipcRenderer.invoke("settings:check-for-updates") as Promise<{
        hasUpdate: boolean;
        latestVersion?: string;
      }>,
    rtkGain: () => ipcRenderer.invoke("settings:rtk-gain") as Promise<RtkGainStats>,
    readGlobalAgentInstructions: () =>
      ipcRenderer.invoke("settings:global-agent-instructions:read") as Promise<{
        path: string;
        content: string;
        exists: boolean;
        maxBytes: number;
      }>,
    writeGlobalAgentInstructions: (content: string) =>
      ipcRenderer.invoke("settings:global-agent-instructions:write", content) as Promise<{
        path: string;
        content: string;
        exists: boolean;
        maxBytes: number;
      }>,
    writeGlobalRtkInstructions: (content: string) =>
      ipcRenderer.invoke("settings:global-rtk-instructions:write", content) as Promise<{
        path: string;
        content: string;
      }>,
  },
  git: {
    branches: (projectPath: string) =>
      ipcRenderer.invoke("git:branches", projectPath) as Promise<GitBranchInfo>,
    checkout: (projectPath: string, branch: string) =>
      ipcRenderer.invoke("git:checkout", projectPath, branch) as Promise<GitBranchInfo>,
    createBranch: (projectPath: string, branch: string) =>
      ipcRenderer.invoke("git:createBranch", projectPath, branch) as Promise<GitBranchInfo>,
    workspaceSnapshot: (projectPath: string) =>
      ipcRenderer.invoke(
        "git:workspace-snapshot",
        projectPath,
      ) as Promise<GitWorkspaceSnapshotResult>,
    workspaceDiff: (projectPath: string, baseRevision?: string) =>
      ipcRenderer.invoke(
        "git:workspace-diff",
        projectPath,
        baseRevision ?? null,
      ) as Promise<GitWorkspaceDiffResult>,
  },
};

contextBridge.exposeInMainWorld("carrent", carrent);
