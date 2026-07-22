import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AttachmentKind, AttachmentMetadata } from "../../src/shared/chat";
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
  resolveRoot: () => string;
  resolvePath: (storageKey: string) => string;
  deleteAttachments: (storageKeys: string[]) => Promise<void>;
};

export function createAttachmentStore(baseDir: string): AttachmentStore {
  const attachmentsDir = join(baseDir, "attachments");

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
    };
  }

  async function readAttachment(storageKey: string): Promise<Uint8Array> {
    const buffer = await readFile(join(attachmentsDir, assertValidAttachmentStorageKey(storageKey)));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  function resolvePath(storageKey: string): string {
    return join(attachmentsDir, assertValidAttachmentStorageKey(storageKey));
  }

  function resolveRoot(): string {
    return attachmentsDir;
  }

  async function deleteAttachments(storageKeys: string[]): Promise<void> {
    const validatedKeys = [...new Set(storageKeys.map(assertValidAttachmentStorageKey))];

    for (const storageKey of validatedKeys) {
      try {
        await unlink(join(attachmentsDir, storageKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  return {
    storeAttachment,
    readAttachment,
    resolveRoot,
    resolvePath,
    deleteAttachments,
  };
}
