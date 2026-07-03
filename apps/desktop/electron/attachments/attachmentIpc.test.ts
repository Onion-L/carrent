import { describe, expect, it } from "bun:test";
import { registerAttachmentIpc } from "./attachmentIpc";
import type { AttachmentStore } from "./attachmentStore";

function createMockStore(): AttachmentStore {
  let stored: Uint8Array | null = null;

  return {
    async storeAttachment(input) {
      stored = input.data;
      return {
        id: "attachment-1",
        name: input.name,
        mimeType: input.mimeType,
        size: input.data.length,
        storageKey: "attachment-1.png",
      };
    },
    async readAttachment() {
      if (!stored) {
        throw new Error("Not found");
      }
      return stored;
    },
    resolvePath(storageKey) {
      return `/tmp/attachments/${storageKey}`;
    },
  };
}

describe("registerAttachmentIpc", () => {
  it("registers attachments:store and attachments:read channels", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerAttachmentIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      { attachmentStore: createMockStore() },
    );

    expect([...handlers.keys()].sort()).toEqual(["attachments:read", "attachments:store"]);
  });

  it("attachments:store forwards to the store and returns metadata", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerAttachmentIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      { attachmentStore: createMockStore() },
    );

    const result = (await handlers.get("attachments:store")?.(
      {},
      {
        name: "test.png",
        mimeType: "image/png",
        data: new Uint8Array([1, 2, 3]),
      },
    )) as { storageKey: string; name: string };

    expect(result.name).toBe("test.png");
    expect(result.storageKey).toBe("attachment-1.png");
  });

  it("attachments:read returns stored bytes", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerAttachmentIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      { attachmentStore: createMockStore() },
    );

    await handlers.get("attachments:store")?.(
      {},
      {
        name: "test.png",
        mimeType: "image/png",
        data: new Uint8Array([4, 5, 6]),
      },
    );

    const read = (await handlers.get("attachments:read")?.({}, "attachment-1.png")) as Uint8Array;
    expect(read).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("attachments:store rejects unsupported MIME types", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerAttachmentIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      { attachmentStore: createMockStore() },
    );

    try {
      await handlers.get("attachments:store")?.(
        {},
        {
          name: "notes.txt",
          mimeType: "text/plain",
          data: new Uint8Array([1, 2, 3]),
        },
      );
      expect(false).toBe(true);
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toContain(
        "Unsupported image format",
      );
    }
  });

  it("attachments:store rejects non-byte data", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerAttachmentIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      { attachmentStore: createMockStore() },
    );

    try {
      await handlers.get("attachments:store")?.(
        {},
        {
          name: "test.png",
          mimeType: "image/png",
          data: [1, 2, 3],
        },
      );
      expect(false).toBe(true);
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toContain(
        "Invalid attachment data",
      );
    }
  });
});
