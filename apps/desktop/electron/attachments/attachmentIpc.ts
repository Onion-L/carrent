import type { AttachmentStore } from "./attachmentStore";
import type { AttachmentKind } from "../../src/shared/chat";
import {
  MAX_ATTACHMENT_MIME_TYPE_CHARS,
  MAX_ATTACHMENT_NAME_BYTES,
  classifyAttachmentBytes,
  validateAttachmentSelection,
} from "../../src/shared/attachment";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export interface AttachmentIpcServices {
  attachmentStore: AttachmentStore;
}

function readStoreInput(input: unknown): {
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  data: Uint8Array;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid attachment input.");
  }

  const record = input as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.mimeType !== "string") {
    throw new Error("Invalid attachment input.");
  }

  const name = record.name;
  if (
    name.trim().length === 0 ||
    new TextEncoder().encode(name).length > MAX_ATTACHMENT_NAME_BYTES
  ) {
    throw new Error("Invalid attachment name.");
  }

  if (record.mimeType.length > MAX_ATTACHMENT_MIME_TYPE_CHARS) {
    throw new Error("Invalid attachment input.");
  }

  if (!(record.data instanceof Uint8Array)) {
    throw new Error("Invalid attachment data.");
  }

  const validation = validateAttachmentSelection([{ size: record.data.byteLength }]);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  // Classify the actual bytes; a renderer-proposed kind is never trusted.
  const classification = classifyAttachmentBytes({
    name,
    mimeType: record.mimeType,
    data: record.data,
  });
  if (!classification.ok) {
    throw new Error(classification.reason);
  }

  const mimeType =
    classification.kind === "file" && record.mimeType.length === 0
      ? "text/plain"
      : record.mimeType;

  return {
    name,
    mimeType,
    kind: classification.kind,
    data: record.data,
  };
}

export function registerAttachmentIpc(ipcMainLike: IpcMainLike, services: AttachmentIpcServices) {
  ipcMainLike.handle("attachments:store", async (_event, input) => {
    const { name, mimeType, kind, data } = readStoreInput(input);
    return services.attachmentStore.storeAttachment({ name, mimeType, kind, data });
  });

  ipcMainLike.handle("attachments:read", async (_event, storageKey) => {
    return services.attachmentStore.readAttachment(storageKey as string);
  });
}
