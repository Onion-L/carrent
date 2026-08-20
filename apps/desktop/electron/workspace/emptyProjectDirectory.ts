import { mkdir, realpath, rmdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { validateNewProjectName } from "../../src/shared/emptyProject";
import type {
  CreateEmptyProjectDirectoryRequest,
  CreateEmptyProjectDirectoryResult,
} from "../../src/shared/emptyProject";
import type { AppStateSettings } from "../../src/shared/workspacePersistence";

type IpcMainLike = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
};

/**
 * Default base for newly created empty Projects: a CarrentProjects directory
 * inside the OS user directory. Kept dynamic (never persisted) so the stored
 * setting only ever holds an explicit custom override.
 */
export function getDefaultNewProjectBaseDirectory(homeDirectory: string = homedir()): string {
  return join(homeDirectory, "CarrentProjects");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Translates filesystem permission failures into a user-facing message. */
function notWritableError(base: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return new Error(`New Project location is not writable: ${base}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Creates empty Project directories in Main. The Renderer never touches the
 * filesystem directly; it passes a validated name plus an optional
 * per-creation base override and receives the canonical absolute path to
 * persist as the Project Working Directory.
 */
export function createEmptyProjectDirectoryManager(options: {
  loadSettings?: () => Promise<Pick<AppStateSettings, "newProjectLocation"> | null>;
  homeDirectory?: string;
}) {
  const defaultBase = () => getDefaultNewProjectBaseDirectory(options.homeDirectory);
  // Canonical paths this manager created, so rollback can never touch a
  // directory that merely exists on disk.
  const createdDirectories = new Set<string>();

  const create = async (
    request: CreateEmptyProjectDirectoryRequest,
  ): Promise<CreateEmptyProjectDirectoryResult> => {
    const validation = validateNewProjectName(request.name);
    if (!validation.ok) throw new Error(validation.error);

    // An explicit per-creation override wins over the configured custom
    // location, which wins over the dynamic default.
    const overrideBase = request.baseDirectory?.trim();
    const settingsBase = overrideBase
      ? undefined
      : (await options.loadSettings?.())?.newProjectLocation;
    const base = overrideBase ?? settingsBase ?? defaultBase();

    if (resolve(base) === resolve(defaultBase())) {
      // The default base is created lazily on first use.
      await mkdir(base, { recursive: true }).catch((error: unknown) => {
        throw notWritableError(base, error);
      });
    } else if (!(await isDirectory(base))) {
      // A custom location that disappeared (or was never created) is an error,
      // not a silent fallback — the setting stays untouched.
      throw new Error(`New Project location is unavailable: ${base}`);
    }

    const target = join(base, validation.name);
    try {
      await mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `A folder named "${validation.name}" already exists at ${base}. ` +
            "Choose another name or use Open Existing Project instead.",
        );
      }
      throw notWritableError(base, error);
    }
    const workingDirectory = await realpath(target);
    createdDirectories.add(workingDirectory);
    return { workingDirectory };
  };

  /**
   * Rollback for staged Workspace creation: removes a directory, but only one
   * this manager created (tracked above) that is still empty. `rmdir` refuses
   * non-empty directories, so a directory that gained content is always kept,
   * and paths the renderer merely claims are never touched.
   */
  const removeIfEmpty = async (workingDirectory: string): Promise<{ removed: boolean }> => {
    if (!createdDirectories.has(workingDirectory)) return { removed: false };
    try {
      await rmdir(workingDirectory);
      createdDirectories.delete(workingDirectory);
      return { removed: true };
    } catch {
      return { removed: false };
    }
  };

  return { create, removeIfEmpty, defaultBaseDirectory: defaultBase };
}

export function registerEmptyProjectDirectoryIpc(
  ipcMainLike: IpcMainLike,
  manager: ReturnType<typeof createEmptyProjectDirectoryManager>,
) {
  ipcMainLike.handle("project-directory:default-base", async () => ({
    baseDirectory: manager.defaultBaseDirectory(),
  }));

  ipcMainLike.handle("project-directory:create-empty", async (_event, request) => {
    if (!request || typeof request !== "object") {
      throw new Error("Invalid empty Project creation request.");
    }
    const { name, baseDirectory } = request as Record<string, unknown>;
    if (
      typeof name !== "string" ||
      (baseDirectory !== undefined && (typeof baseDirectory !== "string" || !baseDirectory.trim()))
    ) {
      throw new Error("Invalid empty Project creation request.");
    }
    return manager.create({
      name,
      ...(typeof baseDirectory === "string" ? { baseDirectory: resolve(baseDirectory) } : {}),
    });
  });

  ipcMainLike.handle("project-directory:remove-empty", async (_event, workingDirectory) => {
    if (typeof workingDirectory !== "string" || !workingDirectory.trim()) {
      throw new Error("Invalid Project Working Directory.");
    }
    return manager.removeIfEmpty(workingDirectory);
  });
}
