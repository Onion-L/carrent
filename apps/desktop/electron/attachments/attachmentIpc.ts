import type { AttachmentStore } from "./attachmentStore";
import { validateImageAttachments } from "../../src/shared/imageAttachment";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export interface AttachmentIpcServices {
  attachmentStore: AttachmentStore;
}

function readStoreInput(input: unknown): { name: string; mimeType: string; data: Uint8Array } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid attachment input.");
  }

  const record = input as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.mimeType !== "string") {
    throw new Error("Invalid attachment input.");
  }

  if (!(record.data instanceof Uint8Array)) {
    throw new Error("Invalid attachment data.");
  }

  const validation = validateImageAttachments([
    {
      type: record.mimeType,
      size: record.data.byteLength,
    },
  ]);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  return {
    name: record.name,
    mimeType: record.mimeType,
    data: record.data,
  };
}

export function registerAttachmentIpc(ipcMainLike: IpcMainLike, services: AttachmentIpcServices) {
  ipcMainLike.handle("attachments:store", async (_event, input) => {
    const { name, mimeType, data } = readStoreInput(input);
    return services.attachmentStore.storeAttachment({ name, mimeType, data });
  });

  ipcMainLike.handle("attachments:read", async (_event, storageKey) => {
    return services.attachmentStore.readAttachment(storageKey as string);
  });
}
