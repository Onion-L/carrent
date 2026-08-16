import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
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
import type { LocalPathResolutionResult, RevealPathResult } from "../src/shared/localPathContext";
import type { RuntimeId } from "../src/shared/runtimes";
import type {
  GitBranchInfo,
  GitWorkspaceDiffResult,
  GitWorkspaceSnapshotResult,
} from "./git/gitIpc";
import type { RtkGainStats } from "../src/shared/rtk";
import type { UpdateCheckResult } from "../src/shared/updates";
import type { KimiUsageStats } from "../src/shared/kimiUsage";
import type { KimiMemoryIndex } from "../src/shared/kimiMemory";
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
} from "../src/shared/worktrees";
import type { DetectedEditor, EditorsApi } from "../src/shared/editors";
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
import type {
  BrowserActionRequest,
  BrowserApi,
  BrowserClearDataRequest,
  BrowserMenuActionEvent,
  BrowserMenuCloseRequest,
  BrowserMenuClosedEvent,
  BrowserMenuOpenRequest,
  BrowserMenuSession,
  BrowserMenuUpdateRequest,
  BrowserNavigateRequest,
  BrowserOpenRequest,
  BrowserSearchEngine,
  BrowserTheme,
  BrowserTabTarget,
  BrowserThreadState,
  BrowserThreadTarget,
  BrowserZoomRequest,
} from "../src/shared/browser";
import { createLocalPathContextPreloadApi } from "./preloadLocalPathContext";

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
  onCmdWCloseTab: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on("terminal:cmd-w", wrapped);
    return () => ipcRenderer.removeListener("terminal:cmd-w", wrapped);
  },
};

const carrent = {
  platform: process.platform,
  electronVersion: process.versions.electron,
  mainWindow,
  browser: {
    activate: (target: BrowserThreadTarget | null) =>
      ipcRenderer.invoke("browser:activate", target) as Promise<BrowserThreadState | null>,
    open: (request: BrowserOpenRequest) =>
      ipcRenderer.invoke("browser:open", request) as Promise<BrowserThreadState>,
    newTab: (target: BrowserThreadTarget) =>
      ipcRenderer.invoke("browser:new-tab", target) as Promise<BrowserThreadState>,
    activateTab: (target: BrowserTabTarget) =>
      ipcRenderer.invoke("browser:activate-tab", target) as Promise<BrowserThreadState>,
    closeTab: (target: BrowserTabTarget) =>
      ipcRenderer.invoke("browser:close-tab", target) as Promise<BrowserThreadState>,
    navigate: (request: BrowserNavigateRequest) =>
      ipcRenderer.invoke("browser:navigate", request) as Promise<BrowserThreadState>,
    action: (request: BrowserActionRequest) =>
      ipcRenderer.invoke("browser:action", request) as Promise<BrowserThreadState>,
    zoom: (request: BrowserZoomRequest) =>
      ipcRenderer.invoke("browser:zoom", request) as Promise<BrowserThreadState>,
    openMenu: (request: BrowserMenuOpenRequest) =>
      ipcRenderer.invoke("browser:menu-open", request) as Promise<BrowserMenuSession>,
    updateMenu: (request: BrowserMenuUpdateRequest) =>
      ipcRenderer.invoke("browser:menu-update", request) as Promise<void>,
    closeMenu: (request: BrowserMenuCloseRequest) =>
      ipcRenderer.invoke("browser:menu-close", request) as Promise<void>,
    find: (request: BrowserTabTarget & { text: string; forward?: boolean }) =>
      ipcRenderer.invoke("browser:find", request) as Promise<void>,
    stopFind: (target: BrowserTabTarget) =>
      ipcRenderer.invoke("browser:stop-find", target) as Promise<void>,
    continueCertificate: (target: BrowserTabTarget) =>
      ipcRenderer.invoke("browser:continue-certificate", target) as Promise<BrowserThreadState>,
    setBounds: (
      request: BrowserThreadTarget & { bounds: import("../src/shared/browser").BrowserBounds },
    ) => ipcRenderer.invoke("browser:set-bounds", request) as Promise<void>,
    setVisible: (request: BrowserThreadTarget & { visible: boolean }) =>
      ipcRenderer.invoke("browser:set-visible", request) as Promise<void>,
    popOut: (target: BrowserThreadTarget) =>
      ipcRenderer.invoke("browser:pop-out", target) as Promise<BrowserThreadState>,
    dock: (target: BrowserThreadTarget) =>
      ipcRenderer.invoke("browser:dock", target) as Promise<BrowserThreadState>,
    openExternal: (target: BrowserTabTarget) =>
      ipcRenderer.invoke("browser:open-external", target) as Promise<void>,
    clearData: (request: BrowserClearDataRequest) =>
      ipcRenderer.invoke("browser:clear-data", request) as Promise<BrowserThreadState>,
    setSearchEngine: (request: BrowserThreadTarget & { searchEngine: BrowserSearchEngine }) =>
      ipcRenderer.invoke("browser:set-search-engine", request) as Promise<BrowserThreadState>,
    setTheme: (theme: BrowserTheme) =>
      ipcRenderer.invoke("browser:set-theme", theme) as Promise<void>,
    onState: (listener: (state: BrowserThreadState) => void) => {
      const wrapped = (_event: IpcRendererEvent, state: BrowserThreadState) => listener(state);
      ipcRenderer.on("browser:state", wrapped);
      return () => ipcRenderer.removeListener("browser:state", wrapped);
    },
    onFocusAddress: (listener: () => void) => {
      const wrapped = () => listener();
      ipcRenderer.on("browser:focus-address", wrapped);
      return () => ipcRenderer.removeListener("browser:focus-address", wrapped);
    },
    onFind: (listener: () => void) => {
      const wrapped = () => listener();
      ipcRenderer.on("browser:find", wrapped);
      return () => ipcRenderer.removeListener("browser:find", wrapped);
    },
    onMenuAction: (listener: (event: BrowserMenuActionEvent) => void) => {
      const wrapped = (_event: IpcRendererEvent, actionEvent: BrowserMenuActionEvent) =>
        listener(actionEvent);
      ipcRenderer.on("browser:menu-action", wrapped);
      return () => ipcRenderer.removeListener("browser:menu-action", wrapped);
    },
    onMenuClosed: (listener: (event: BrowserMenuClosedEvent) => void) => {
      const wrapped = (_event: IpcRendererEvent, closedEvent: BrowserMenuClosedEvent) =>
        listener(closedEvent);
      ipcRenderer.on("browser:menu-closed", wrapped);
      return () => ipcRenderer.removeListener("browser:menu-closed", wrapped);
    },
  } satisfies BrowserApi,
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
        import("../src/shared/chat").KimiTelemetryStatus | null
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
    list: (projectDir?: string) =>
      ipcRenderer.invoke("skills:list", projectDir) as Promise<SkillRecord[]>,
  },
  dialog: {
    openDirectory: () =>
      ipcRenderer.invoke("dialog:open-directory") as Promise<{
        canceled: boolean;
        filePaths: string[];
      }>,
  },
  shell: {
    revealPath: (filePath: string) =>
      ipcRenderer.invoke("shell:reveal-path", filePath) as Promise<RevealPathResult>,
    openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url) as Promise<void>,
  },
  // webUtils.getPathForFile must receive the original DOM File in preload;
  // Main then validates the resolved path without exposing fs to Renderer.
  localPaths: createLocalPathContextPreloadApi(
    (file) => webUtils.getPathForFile(file),
    (paths) =>
      ipcRenderer.invoke("local-paths:resolve", paths) as Promise<LocalPathResolutionResult>,
  ),
  editors: {
    list: () => ipcRenderer.invoke("editors:list") as Promise<DetectedEditor[]>,
    open: (editorId: string, workingDirectory: string) =>
      ipcRenderer.invoke("editors:open", editorId, workingDirectory) as Promise<string>,
  } satisfies EditorsApi,
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
    getAppVersion: () => ipcRenderer.invoke("settings:app-version") as Promise<string>,
    checkForUpdates: () =>
      ipcRenderer.invoke("settings:check-for-updates") as Promise<UpdateCheckResult>,
    rtkGain: () => ipcRenderer.invoke("settings:rtk-gain") as Promise<RtkGainStats>,
    kimiUsage: () => ipcRenderer.invoke("settings:kimi-usage") as Promise<KimiUsageStats>,
    kimiMemory: () => ipcRenderer.invoke("settings:kimi-memory") as Promise<KimiMemoryIndex>,
    worktrees: () => ipcRenderer.invoke("settings:worktrees") as Promise<WorktreeScanResult>,
    worktreesPrune: (request: WorktreePruneRequest) =>
      ipcRenderer.invoke("settings:worktrees:prune", request) as Promise<WorktreePruneResult>,
    worktreesRemove: (request: WorktreeRemoveRequest) =>
      ipcRenderer.invoke("settings:worktrees:remove", request) as Promise<WorktreeRemoveResult>,
    worktreeSizesStart: (targets: WorktreeSizeTarget[], options?: WorktreeSizeStartOptions) =>
      ipcRenderer.invoke(
        "settings:worktrees:sizes:start",
        targets,
        options,
      ) as Promise<WorktreeSizeStartResult>,
    worktreeSizesCancel: (generation: number) =>
      ipcRenderer.invoke("settings:worktrees:sizes:cancel", generation) as Promise<void>,
    onWorktreeSizeEvent: (listener: (event: WorktreeSizeEvent) => void) => {
      const wrapped = (_event: IpcRendererEvent, sizeEvent: WorktreeSizeEvent) =>
        listener(sizeEvent);
      ipcRenderer.on("settings:worktrees:sizes:event", wrapped);
      return () => ipcRenderer.removeListener("settings:worktrees:sizes:event", wrapped);
    },
    kimiMemoryDelete: (filePath: string) =>
      ipcRenderer.invoke("settings:kimi-memory:delete", filePath) as Promise<void>,
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
