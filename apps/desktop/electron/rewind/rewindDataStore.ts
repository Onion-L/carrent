import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

export type RewindCheckpoint = {
  ref: string;
  objectId: string;
};

export type RewindReadyNode = {
  id: string;
  projectId: string;
  threadId: string;
  state: "ready";
  before: RewindCheckpoint;
  after: RewindCheckpoint;
};

export type RewindBarrierNode = {
  id: string;
  projectId: string;
  threadId: string;
  state: "barrier";
  reason: "project-directory-relocation";
};

export type RewindNode = RewindReadyNode | RewindBarrierNode;

export type RewindDataSnapshot = {
  version: 1;
  nodes: RewindNode[];
};

export type RewindRelocationReceipt = {
  before: RewindDataSnapshot;
};

type CheckpointValidation = RewindCheckpoint & {
  workingDirectory: string;
};

type RewindDataStoreOptions = {
  validateCheckpoint: (checkpoint: CheckpointValidation) => Promise<boolean>;
  deleteCheckpoint: (checkpoint: {
    workingDirectory: string;
    ref: string;
    expectedObjectId: string;
  }) => Promise<void>;
};

type RewindDeletionBackup = {
  version: 1;
  before: RewindDataSnapshot;
  threadIds: string[];
  projectDirectories: Record<string, string>;
};

const EMPTY_REWIND_DATA: RewindDataSnapshot = { version: 1, nodes: [] };
const execFileAsync = promisify(execFile);

function assertRewindRef(ref: string): string {
  if (
    !ref.startsWith("refs/carrent/rewind/") ||
    ref.length > 512 ||
    /[\s~^:?*[\]\\]/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new Error("Invalid Rewind checkpoint ref.");
  }
  return ref;
}

function assertObjectId(objectId: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(objectId)) {
    throw new Error("Invalid Rewind checkpoint object ID.");
  }
  return objectId;
}

async function runGit(workingDirectory: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", workingDirectory, ...args], {
    encoding: "utf-8",
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  return stdout.trim();
}

export function createGitRewindCheckpointAccess() {
  return {
    async validateCheckpoint(checkpoint: CheckpointValidation): Promise<boolean> {
      try {
        const ref = assertRewindRef(checkpoint.ref);
        const objectId = assertObjectId(checkpoint.objectId);
        return (
          (await runGit(checkpoint.workingDirectory, ["show-ref", "--verify", "--hash", ref])) ===
          objectId
        );
      } catch {
        return false;
      }
    },
    async deleteCheckpoint(checkpoint: {
      workingDirectory: string;
      ref: string;
      expectedObjectId: string;
    }): Promise<void> {
      const ref = assertRewindRef(checkpoint.ref);
      const expectedObjectId = assertObjectId(checkpoint.expectedObjectId);
      let currentObjectId: string;
      try {
        currentObjectId = await runGit(checkpoint.workingDirectory, [
          "show-ref",
          "--verify",
          "--hash",
          ref,
        ]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException & { code?: number }).code === 1) return;
        throw error;
      }
      if (currentObjectId !== expectedObjectId) {
        throw new Error("Rewind checkpoint ref no longer points to the expected object.");
      }
      await runGit(checkpoint.workingDirectory, ["update-ref", "-d", ref, expectedObjectId]);
    },
  };
}

export function createRewindDataStore(baseDir: string, options: RewindDataStoreOptions) {
  const dataPath = join(baseDir, "rewind-data.json");

  async function load(): Promise<RewindDataSnapshot> {
    try {
      return JSON.parse(await readFile(dataPath, "utf-8")) as RewindDataSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_REWIND_DATA);
      }
      throw error;
    }
  }

  async function save(snapshot: RewindDataSnapshot): Promise<void> {
    await mkdir(baseDir, { recursive: true });
    const temporaryPath = `${dataPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf-8");
    await rename(temporaryPath, dataPath);
  }

  async function checkpointIsValid(
    workingDirectory: string,
    checkpoint: RewindCheckpoint,
  ): Promise<boolean> {
    try {
      return await options.validateCheckpoint({ workingDirectory, ...checkpoint });
    } catch {
      return false;
    }
  }

  async function prepareProjectRelocation(input: {
    projectId: string;
    sourceDirectory: string;
    targetDirectory: string;
  }): Promise<RewindRelocationReceipt> {
    const before = await load();
    const nodes = await Promise.all(
      before.nodes.map(async (node): Promise<RewindNode> => {
        if (node.projectId !== input.projectId || node.state === "barrier") {
          return node;
        }
        const [beforeValid, afterValid] = await Promise.all([
          checkpointIsValid(input.targetDirectory, node.before),
          checkpointIsValid(input.targetDirectory, node.after),
        ]);
        if (beforeValid && afterValid) return node;
        return {
          id: node.id,
          projectId: node.projectId,
          threadId: node.threadId,
          state: "barrier",
          reason: "project-directory-relocation",
        };
      }),
    );
    await save({ version: 1, nodes });
    return { before };
  }

  async function rollbackProjectRelocation(receipt: RewindRelocationReceipt): Promise<void> {
    await save(receipt.before);
  }

  function completeProjectRelocation(_receipt: RewindRelocationReceipt): void {}

  function deletionBackupPath(operationId: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
      throw new Error("Invalid Rewind deletion operation.");
    }
    return join(baseDir, `rewind-delete-${operationId}.json`);
  }

  async function loadDeletionBackup(operationId: string): Promise<RewindDeletionBackup | null> {
    try {
      return JSON.parse(
        await readFile(deletionBackupPath(operationId), "utf-8"),
      ) as RewindDeletionBackup;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function prepareDeletion(
    operationId: string,
    input: { threadIds: string[]; projectDirectories: Record<string, string> },
  ): Promise<void> {
    const before = await load();
    const threadIds = [...new Set(input.threadIds)];
    const deletedThreadIds = new Set(threadIds);
    const backup: RewindDeletionBackup = {
      version: 1,
      before,
      threadIds,
      projectDirectories: input.projectDirectories,
    };
    await mkdir(baseDir, { recursive: true });
    await writeFile(deletionBackupPath(operationId), JSON.stringify(backup, null, 2), "utf-8");
    try {
      await save({
        version: 1,
        nodes: before.nodes.filter((node) => !deletedThreadIds.has(node.threadId)),
      });
    } catch (error) {
      await rm(deletionBackupPath(operationId), { force: true });
      throw error;
    }
  }

  async function commitDeletion(operationId: string): Promise<void> {
    const backup = await loadDeletionBackup(operationId);
    if (!backup) return;
    const threadIds = new Set(backup.threadIds);
    for (const node of backup.before.nodes) {
      if (!threadIds.has(node.threadId) || node.state === "barrier") continue;
      const workingDirectory = backup.projectDirectories[node.projectId];
      if (!workingDirectory) {
        throw new Error(`Missing Project Working Directory for Rewind node ${node.id}.`);
      }
      for (const checkpoint of [node.before, node.after]) {
        await options.deleteCheckpoint({
          workingDirectory,
          ref: checkpoint.ref,
          expectedObjectId: checkpoint.objectId,
        });
      }
    }
    await rm(deletionBackupPath(operationId), { force: true });
  }

  async function rollbackDeletion(operationId: string): Promise<void> {
    const backup = await loadDeletionBackup(operationId);
    if (!backup) return;
    await save(backup.before);
    await rm(deletionBackupPath(operationId), { force: true });
  }

  return {
    load,
    save,
    prepareProjectRelocation,
    rollbackProjectRelocation,
    completeProjectRelocation,
    prepareDeletion,
    commitDeletion,
    rollbackDeletion,
  };
}
