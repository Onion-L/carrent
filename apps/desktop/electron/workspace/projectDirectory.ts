import { stat } from "node:fs/promises";
import {
  getProjectWorkingDirectoryIdentity,
  normalizeProjectWorkingDirectory,
  type AppStateSnapshot,
  type ProjectRelocationRequest,
  type WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";

export type RuntimeSessionDetachmentReceipt = {
  threadIds: string[];
  providerSessions: Record<string, string>;
  runtimeSessions: Record<string, string>;
};

type ProjectRelocationStore = {
  waitForWrites: () => Promise<void>;
  loadAppStateSnapshot: () => Promise<AppStateSnapshot | null>;
  saveAppStateSnapshot: (snapshot: AppStateSnapshot) => Promise<void>;
  loadWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  saveWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => Promise<void>;
};

type ProjectRelocationSessionManager = {
  hasLiveRunForThreads: (threadIds: string[]) => boolean;
  detachRuntimeSessions: (threadIds: string[]) => Promise<RuntimeSessionDetachmentReceipt>;
  restoreRuntimeSessions: (receipt: RuntimeSessionDetachmentReceipt) => Promise<void>;
  completeRuntimeSessionDetachment: (receipt: RuntimeSessionDetachmentReceipt) => void;
};

type IpcMainLike = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
};

export async function isProjectDirectoryAvailable(workingDirectory: string): Promise<boolean> {
  try {
    return (await stat(workingDirectory)).isDirectory();
  } catch {
    return false;
  }
}

async function retryTwice(operation: () => Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function createProjectRelocationManager(options: {
  workspaceStore: ProjectRelocationStore;
  sessionManager: ProjectRelocationSessionManager;
  checkDirectory?: (workingDirectory: string) => Promise<boolean>;
  onActiveChange?: (active: boolean) => void;
}) {
  let queue = Promise.resolve();
  const runExclusive = <T>(operation: () => Promise<T>) => {
    const result = queue.catch(() => {}).then(operation);
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  return {
    relocate: (request: ProjectRelocationRequest) =>
      runExclusive(async () => {
        options.onActiveChange?.(true);
        try {
          const targetDirectory = normalizeProjectWorkingDirectory(request.targetDirectory);
          if (!request.projectId || !targetDirectory) {
            throw new Error("Invalid Project relocation request.");
          }
          if (!(await (options.checkDirectory ?? isProjectDirectoryAvailable)(targetDirectory))) {
            throw new Error("Selected Project Working Directory is unavailable.");
          }

          await options.workspaceStore.waitForWrites();
          const beforeAppState = await options.workspaceStore.loadAppStateSnapshot();
          const beforeWorkspace = await options.workspaceStore.loadWorkspaceSnapshot();
          if (!beforeAppState || !beforeWorkspace) {
            throw new Error("Project relocation requires persisted App State and workspace data.");
          }

          const project = beforeAppState.projects.find((item) => item.id === request.projectId);
          if (!project) throw new Error("Project not found.");
          const targetIdentity = getProjectWorkingDirectoryIdentity(targetDirectory);
          if (
            beforeAppState.projects.some(
              (item) =>
                item.id !== project.id &&
                getProjectWorkingDirectoryIdentity(item.workingDirectory) === targetIdentity,
            )
          ) {
            throw new Error("Selected directory already belongs to another Project.");
          }

          const threadIds = (beforeAppState.threads ?? [])
            .filter((thread) => thread.projectId === project.id)
            .map((thread) => thread.id);
          if (options.sessionManager.hasLiveRunForThreads(threadIds)) {
            throw new Error("Stop the Project's live Run before relocating its directory.");
          }

          const afterAppState: AppStateSnapshot = {
            ...beforeAppState,
            projects: beforeAppState.projects.map((item) =>
              item.id === project.id ? { ...item, workingDirectory: targetDirectory } : item,
            ),
          };
          const afterWorkspace: WorkspaceSnapshot = {
            ...beforeWorkspace,
            projects: beforeWorkspace.projects.map((item) =>
              item.id === project.id ? { ...item, path: targetDirectory } : item,
            ),
          };

          const receipt = await options.sessionManager.detachRuntimeSessions(threadIds);
          try {
            await options.workspaceStore.saveAppStateSnapshot(afterAppState);
            await options.workspaceStore.saveWorkspaceSnapshot(afterWorkspace);
            options.sessionManager.completeRuntimeSessionDetachment(receipt);
          } catch (error) {
            const rollbackErrors: unknown[] = [];
            for (const operation of [
              () => options.workspaceStore.saveAppStateSnapshot(beforeAppState),
              () => options.workspaceStore.saveWorkspaceSnapshot(beforeWorkspace),
              () => options.sessionManager.restoreRuntimeSessions(receipt),
            ]) {
              try {
                await retryTwice(operation);
              } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
              }
            }
            if (rollbackErrors.length > 0) {
              throw new AggregateError(
                [error, ...rollbackErrors],
                "Project relocation failed and could not be fully rolled back.",
              );
            }
            throw error;
          }

          return { appState: afterAppState, workspace: afterWorkspace };
        } finally {
          options.onActiveChange?.(false);
        }
      }),
  };
}

export function registerProjectDirectoryIpc(
  ipcMainLike: IpcMainLike,
  services: {
    checkDirectory?: (workingDirectory: string) => Promise<boolean>;
    relocationManager?: {
      relocate: (request: ProjectRelocationRequest) => Promise<{
        appState: AppStateSnapshot;
        workspace: WorkspaceSnapshot;
      }>;
    };
  } = {},
) {
  ipcMainLike.handle("project-directory:check", async (_event, workingDirectory) => {
    if (typeof workingDirectory !== "string" || !workingDirectory.trim()) {
      throw new Error("Invalid Project Working Directory.");
    }
    return {
      available: await (services.checkDirectory ?? isProjectDirectoryAvailable)(workingDirectory),
    };
  });
  ipcMainLike.handle("project-directory:relocate", async (_event, request) => {
    if (!request || typeof request !== "object") {
      throw new Error("Invalid Project relocation request.");
    }
    const { projectId, targetDirectory } = request as Record<string, unknown>;
    if (
      typeof projectId !== "string" ||
      !projectId.trim() ||
      typeof targetDirectory !== "string" ||
      !targetDirectory.trim()
    ) {
      throw new Error("Invalid Project relocation request.");
    }
    if (!services.relocationManager) {
      throw new Error("Project relocation is unavailable.");
    }
    return services.relocationManager.relocate({ projectId, targetDirectory });
  });
}
