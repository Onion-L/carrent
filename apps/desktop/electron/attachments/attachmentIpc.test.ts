import { describe, expect, it } from "bun:test";
import { registerAttachmentIpc } from "./attachmentIpc";
import type { AttachmentStore } from "./attachmentStore";

function createMockStore(): {
  store: AttachmentStore;
  lastStoreInput: () => Parameters<AttachmentStore["storeAttachment"]>[0] | null;
} {
  let stored: Uint8Array | null = null;
  let lastInput: Parameters<AttachmentStore["storeAttachment"]>[0] | null = null;

  return {
    store: {
      async storeAttachment(input) {
        stored = input.data;
        lastInput = input;
        return {
          id: "attachment-1",
          kind: input.kind,
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
      resolveRoot() {
        return "/tmp/attachments";
      },
      resolvePath(storageKey) {
        return `/tmp/attachments/${storageKey}`;
      },
      async deleteAttachments() {},
    },
    lastStoreInput: () => lastInput,
  };
}

function registerWithMockStore() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const mock = createMockStore();

  registerAttachmentIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    { attachmentStore: mock.store },
  );

  return { handlers, mock };
}

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("registerAttachmentIpc", () => {
  it("registers attachments:store and attachments:read channels", () => {
    const { handlers } = registerWithMockStore();

    expect([...handlers.keys()].sort()).toEqual(["attachments:read", "attachments:store"]);
  });

  it("attachments:store forwards to the store and returns metadata", async () => {
    const { handlers } = registerWithMockStore();

    const result = (await handlers.get("attachments:store")?.(
      {},
      {
        name: "test.png",
        mimeType: "image/png",
        data: new Uint8Array([1, 2, 3]),
      },
    )) as { storageKey: string; name: string; kind: string };

    expect(result.name).toBe("test.png");
    expect(result.kind).toBe("image");
    expect(result.storageKey).toBe("attachment-1.png");
  });

  it("attachments:read returns stored bytes", async () => {
    const { handlers } = registerWithMockStore();

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

  it("stores a UTF-8 .ts file as a File Attachment with the supplied MIME", async () => {
    const { handlers, mock } = registerWithMockStore();

    const result = (await handlers.get("attachments:store")?.(
      {},
      {
        name: "answer.ts",
        mimeType: "text/x-typescript",
        data: utf8("export const answer = 42;\n"),
      },
    )) as { kind: string; mimeType: string };

    expect(result.kind).toBe("file");
    expect(result.mimeType).toBe("text/x-typescript");
    expect(mock.lastStoreInput()?.kind).toBe("file");
  });

  it("normalizes an empty File MIME type to text/plain", async () => {
    const { handlers } = registerWithMockStore();

    const result = (await handlers.get("attachments:store")?.(
      {},
      {
        name: "Makefile",
        mimeType: "",
        data: utf8("all:\n\techo hi\n"),
      },
    )) as { kind: string; mimeType: string };

    expect(result.kind).toBe("file");
    expect(result.mimeType).toBe("text/plain");
  });

  it("accepts a mixed sequence through repeated store calls", async () => {
    const { handlers } = registerWithMockStore();

    const image = (await handlers.get("attachments:store")?.(
      {},
      { name: "a.png", mimeType: "image/png", data: new Uint8Array([0x89, 0x50]) },
    )) as { kind: string };
    const file = (await handlers.get("attachments:store")?.(
      {},
      { name: "b.md", mimeType: "text/markdown", data: utf8("# hi\n") },
    )) as { kind: string };

    expect(image.kind).toBe("image");
    expect(file.kind).toBe("file");
  });

  it("rejects invalid UTF-8 binary data with a clear message", async () => {
    const { handlers } = registerWithMockStore();

    try {
      await handlers.get("attachments:store")?.(
        {},
        {
          name: "document.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x00]),
        },
      );
      expect(false).toBe(true);
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toBe(
        "Unsupported file type. Attach PNG, JPEG, WebP, GIF, or UTF-8 text files.",
      );
    }
  });

  it("rejects PDF and ZIP inputs whose bytes are valid UTF-8", async () => {
    const { handlers } = registerWithMockStore();

    for (const input of [
      {
        name: "document.pdf",
        mimeType: "application/pdf",
        data: utf8("%PDF-1.4\nplain ascii fixture\n"),
      },
      {
        name: "archive.zip",
        mimeType: "application/octet-stream",
        data: utf8("PK plain ascii fixture"),
      },
    ]) {
      try {
        await handlers.get("attachments:store")?.({}, input);
        expect(false).toBe(true);
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).toContain(
          "Unsupported file type",
        );
      }
    }
  });

  it("rejects an oversized attachment", async () => {
    const { handlers } = registerWithMockStore();

    try {
      await handlers.get("attachments:store")?.(
        {},
        {
          name: "big.png",
          mimeType: "image/png",
          data: new Uint8Array(10 * 1024 * 1024 + 1),
        },
      );
      expect(false).toBe(true);
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toContain("10 MB");
    }
  });

  it("rejects an empty or unbounded display name", async () => {
    const { handlers } = registerWithMockStore();

    for (const name of ["", "   ", "x".repeat(256)]) {
      try {
        await handlers.get("attachments:store")?.(
          {},
          { name, mimeType: "image/png", data: new Uint8Array([1]) },
        );
        expect(false).toBe(true);
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).toContain(
          "Invalid attachment name",
        );
      }
    }
  });

  it("does not let a renderer-provided kind override byte classification", async () => {
    const { handlers, mock } = registerWithMockStore();

    const result = (await handlers.get("attachments:store")?.(
      {},
      {
        name: "notes.txt",
        mimeType: "text/plain",
        kind: "image",
        localPath: "/tmp/evil",
        storageKey: "../evil",
        data: utf8("plain text\n"),
      },
    )) as { kind: string; storageKey: string };

    expect(result.kind).toBe("file");
    expect(mock.lastStoreInput()?.kind).toBe("file");
    expect(result.storageKey).toBe("attachment-1.png");
  });

  it("attachments:store rejects non-byte data", async () => {
    const { handlers } = registerWithMockStore();

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
