import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ImageAttachmentMetadata } from "../../src/shared/chat";
import { extensionForMimeType } from "../../src/shared/imageAttachment";

export type AttachmentStore = {
  storeAttachment: (input: {
    name: string;
    mimeType: string;
    data: Uint8Array;
  }) => Promise<ImageAttachmentMetadata>;
  readAttachment: (storageKey: string) => Promise<Uint8Array>;
  resolvePath: (storageKey: string) => string;
};

const SAFE_STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertValidStorageKey(storageKey: string): string {
  if (
    typeof storageKey !== "string" ||
    !SAFE_STORAGE_KEY_PATTERN.test(storageKey) ||
    storageKey.includes("..")
  ) {
    throw new Error("Invalid attachment storage key.");
  }

  return storageKey;
}

export function createAttachmentStore(baseDir: string): AttachmentStore {
  const attachmentsDir = join(baseDir, "attachments");

  async function storeAttachment(input: {
    name: string;
    mimeType: string;
    data: Uint8Array;
  }): Promise<ImageAttachmentMetadata> {
    await mkdir(attachmentsDir, { recursive: true });

    const id = randomUUID();
    const ext = extensionForMimeType(input.mimeType);
    const storageKey = `${id}.${ext}`;
    const targetPath = join(attachmentsDir, storageKey);

    await writeFile(targetPath, input.data);

    return {
      id,
      name: input.name,
      mimeType: input.mimeType,
      size: input.data.length,
      storageKey,
    };
  }

  async function readAttachment(storageKey: string): Promise<Uint8Array> {
    const buffer = await readFile(join(attachmentsDir, assertValidStorageKey(storageKey)));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  function resolvePath(storageKey: string): string {
    return join(attachmentsDir, assertValidStorageKey(storageKey));
  }

  return {
    storeAttachment,
    readAttachment,
    resolvePath,
  };
}
