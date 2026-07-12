import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ChatTurnRequest,
  ChatRunEvent,
  DeleteThreadDataRequest,
  ImageAttachmentMetadata,
} from "../src/shared/chat";
import type { ChatPermissionResponse } from "../src/shared/chatPermissions";
import type { SkillRecord } from "../src/shared/skills";
import type { McpServerStatus } from "../src/shared/mcpServer";
import type {
  WorkspaceSnapshot,
  ProviderSessionSnapshot,
} from "../src/shared/workspacePersistence";
import type { RuntimeId } from "../src/shared/runtimes";
import type { GitBranchInfo, GitWorkspaceDiffResult } from "./git/gitIpc";
import type { RtkGainStats } from "../src/shared/rtk";

const carrent = {
  platform: process.platform,
  electronVersion: process.versions.electron,
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
      ipcRenderer.invoke("chat:send", request) as Promise<{ runId: string }>,
    stop: (runId: string) => ipcRenderer.invoke("chat:stop", runId) as Promise<void>,
    deleteThreadData: (request: DeleteThreadDataRequest) =>
      ipcRenderer.invoke("chat:delete-thread-data", request) as Promise<void>,
    respondToPermission: (response: ChatPermissionResponse) =>
      ipcRenderer.invoke("chat:permission-response", response) as Promise<void>,
    getKimiStatus: (request: ChatTurnRequest) =>
      ipcRenderer.invoke("chat:kimi-status", request) as Promise<
        import("../src/shared/chat").KimiSessionStatus | null
      >,
    onEvent: (listener: (event: ChatRunEvent) => void) => {
      const wrapped = (_event: IpcRendererEvent, evt: ChatRunEvent) => listener(evt);
      ipcRenderer.on("chat:event", wrapped);
      return () => ipcRenderer.removeListener("chat:event", wrapped);
    },
  },
  attachments: {
    store: (input: { name: string; mimeType: string; data: Uint8Array }) =>
      ipcRenderer.invoke("attachments:store", input) as Promise<ImageAttachmentMetadata>,
    read: (storageKey: string) =>
      ipcRenderer.invoke("attachments:read", storageKey) as Promise<Uint8Array>,
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
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke("clipboard:write-text", text),
  },
  workspace: {
    load: () => ipcRenderer.invoke("workspace:load") as Promise<WorkspaceSnapshot | null>,
    remember: (snapshot: WorkspaceSnapshot) => ipcRenderer.send("workspace:remember", snapshot),
    save: (snapshot: WorkspaceSnapshot) => ipcRenderer.invoke("workspace:save", snapshot),
  },
  providerSessions: {
    load: () => ipcRenderer.invoke("provider-sessions:load") as Promise<ProviderSessionSnapshot>,
    save: (snapshot: ProviderSessionSnapshot) =>
      ipcRenderer.invoke("provider-sessions:save", snapshot),
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
    workspaceDiff: (projectPath: string) =>
      ipcRenderer.invoke("git:workspace-diff", projectPath) as Promise<GitWorkspaceDiffResult>,
  },
};

contextBridge.exposeInMainWorld("carrent", carrent);
