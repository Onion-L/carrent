import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  AttachmentIntegrityMetadata,
  AttachmentKind,
  AttachmentMetadata,
} from "../../src/shared/chat";
import {
  assertValidAttachmentStorageKey,
  storageExtensionForAttachment,
} from "../../src/shared/attachment";

export type AttachmentStore = {
  storeAttachment: (input: {
    name: string;
    mimeType: string;
    kind: AttachmentKind;
    data: Uint8Array;
  }) => Promise<AttachmentMetadata>;
  readAttachment: (storageKey: string) => Promise<Uint8Array>;
  readVerifiedAttachment: (attachment: AttachmentIntegrityMetadata) => Promise<Uint8Array>;
  resolveRoot: () => string;
  resolvePath: (storageKey: string) => string;
  resolveVerifiedPath: (attachment: AttachmentIntegrityMetadata) => string;
  deleteAttachments: (storageKeys: string[]) => Promise<void>;
  deleteOrphanedAttachments: (referencedStorageKeys: Set<string>) => Promise<string[]>;
  prepareDeletion?: (operationId: string, storageKeys: string[]) => Promise<void>;
  commitDeletion?: (operationId: string) => Promise<void>;
  rollbackDeletion?: (operationId: string) => Promise<void>;
};

type AttachmentStoreOptions = {
  copy?: (source: string, destination: string) => Promise<void>;
  remove?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
};

export function createAttachmentStore(
  baseDir: string,
  options?: AttachmentStoreOptions,
): AttachmentStore {
  const attachmentsDir = join(baseDir, "attachments");
  const copy = options?.copy ?? copyFile;
  const remove = options?.remove ?? rm;

  function verifyAttachmentBytes(attachment: AttachmentIntegrityMetadata, data: Uint8Array) {
    const digest = createHash("sha256").update(data).digest("hex");
    if (
      data.byteLength !== attachment.size ||
      (attachment.sha256 !== undefined && digest !== attachment.sha256)
    ) {
      throw new Error("Attachment file is unavailable.");
    }
  }

  async function storeAttachment(input: {
    name: string;
    mimeType: string;
    kind: AttachmentKind;
    data: Uint8Array;
  }): Promise<AttachmentMetadata> {
    await mkdir(attachmentsDir, { recursive: true });

    const id = randomUUID();
    const ext = storageExtensionForAttachment({
      kind: input.kind,
      name: input.name,
      mimeType: input.mimeType,
    });
    const storageKey = `${id}.${ext}`;
    const targetPath = join(attachmentsDir, storageKey);

    await writeFile(targetPath, input.data);

    return {
      id,
      kind: input.kind,
      name: input.name,
      mimeType: input.mimeType,
      size: input.data.length,
      storageKey,
      sha256: createHash("sha256").update(input.data).digest("hex"),
    };
  }

  async function readAttachment(storageKey: string): Promise<Uint8Array> {
    const buffer = await readFile(
      join(attachmentsDir, assertValidAttachmentStorageKey(storageKey)),
    );
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async function readVerifiedAttachment(
    attachment: AttachmentIntegrityMetadata,
  ): Promise<Uint8Array> {
    const data = await readAttachment(attachment.storageKey);
    verifyAttachmentBytes(attachment, data);
    return data;
  }

  function resolvePath(storageKey: string): string {
    return join(attachmentsDir, assertValidAttachmentStorageKey(storageKey));
  }

  function resolveVerifiedPath(attachment: AttachmentIntegrityMetadata): string {
    const path = resolvePath(attachment.storageKey);
    let data: Uint8Array;
    try {
      data = readFileSync(path);
    } catch {
      throw new Error("Attachment file is unavailable.");
    }
    verifyAttachmentBytes(attachment, data);
    return path;
  }

  function resolveRoot(): string {
    return attachmentsDir;
  }

  function operationDirectories(operationId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
      throw new Error("Invalid attachment deletion operation.");
    }
    const stagedDir = join(baseDir, `attachments-delete-${operationId}`);
    const backupDir = join(baseDir, `attachments-backup-${operationId}`);
    return { stagedDir, backupDir };
  }

  async function operationKeys(directory: string) {
    try {
      return (await readdir(directory)).map(assertValidAttachmentStorageKey);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async function rollbackDeletion(operationId: string) {
    const { stagedDir, backupDir } = operationDirectories(operationId);
    const storageKeys = [
      ...new Set([...(await operationKeys(stagedDir)), ...(await operationKeys(backupDir))]),
    ];
    const rollbackErrors: unknown[] = [];
    await mkdir(attachmentsDir, { recursive: true });
    for (const storageKey of storageKeys.reverse()) {
      try {
        await rename(join(stagedDir, storageKey), join(attachmentsDir, storageKey));
        continue;
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") {
          rollbackErrors.push(renameError);
          continue;
        }
      }
      try {
        await copy(join(backupDir, storageKey), join(attachmentsDir, storageKey));
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException).code !== "ENOENT") {
          rollbackErrors.push(copyError);
        }
      }
    }
    for (const directory of [stagedDir, backupDir]) {
      try {
        await remove(directory, { recursive: true, force: true });
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        rollbackErrors,
        "Attachment deletion could not be fully rolled back.",
      );
    }
  }

  async function prepareDeletion(operationId: string, storageKeys: string[]) {
    const validatedKeys = [...new Set(storageKeys.map(assertValidAttachmentStorageKey))];
    const { stagedDir, backupDir } = operationDirectories(operationId);
    if (validatedKeys.length === 0) return;
    await mkdir(stagedDir, { recursive: true });
    await mkdir(backupDir, { recursive: true });

    try {
      for (const storageKey of validatedKeys) {
        try {
          await copy(join(attachmentsDir, storageKey), join(backupDir, storageKey));
          await rename(join(attachmentsDir, storageKey), join(stagedDir, storageKey));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      try {
        await rollbackDeletion(operationId);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Attachment deletion failed and could not be fully rolled back.",
        );
      }
      throw error;
    }
  }

  async function commitDeletion(operationId: string) {
    const { stagedDir, backupDir } = operationDirectories(operationId);
    await remove(stagedDir, { recursive: true, force: true });
    await remove(backupDir, { recursive: true, force: true });
  }

  async function deleteAttachments(storageKeys: string[]): Promise<void> {
    const validatedKeys = [...new Set(storageKeys.map(assertValidAttachmentStorageKey))];
    if (validatedKeys.length === 0) return;
    const operationId = randomUUID();
    await prepareDeletion(operationId, validatedKeys);
    try {
      await commitDeletion(operationId);
    } catch (error) {
      try {
        await rollbackDeletion(operationId);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Attachment deletion failed and could not be fully rolled back.",
        );
      }
      throw error;
    }
  }

  async function deleteOrphanedAttachments(referencedStorageKeys: Set<string>): Promise<string[]> {
    let storedEntries;
    try {
      storedEntries = await readdir(attachmentsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const orphaned = storedEntries
      .filter((entry) => entry.isFile() && !referencedStorageKeys.has(entry.name))
      .flatMap((entry) => {
        try {
          return [assertValidAttachmentStorageKey(entry.name)];
        } catch {
          return [];
        }
      })
      .sort();
    await deleteAttachments(orphaned);
    return orphaned;
  }

  return {
    storeAttachment,
    readAttachment,
    readVerifiedAttachment,
    resolveRoot,
    resolvePath,
    resolveVerifiedPath,
    deleteAttachments,
    deleteOrphanedAttachments,
    prepareDeletion,
    commitDeletion,
    rollbackDeletion,
  };
}
