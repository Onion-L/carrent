import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttachmentStore } from "./attachmentStore";

function createTempStore() {
  const baseDir = mkdtempSync(join(tmpdir(), "carrent-attachments-"));
  return {
    store: createAttachmentStore(baseDir),
    baseDir,
    cleanup: () => {
      try {
        rmSync(join(baseDir, "attachments"), { recursive: true, force: true });
        rmSync(baseDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    },
  };
}

describe("createAttachmentStore", () => {
  it("stores an image and returns metadata", async () => {
    const { store, baseDir, cleanup } = createTempStore();

    try {
      const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const metadata = await store.storeAttachment({
        name: "screenshot.png",
        mimeType: "image/png",
        data,
      });

      expect(metadata.name).toBe("screenshot.png");
      expect(metadata.mimeType).toBe("image/png");
      expect(metadata.size).toBe(data.length);
      expect(metadata.storageKey.endsWith(".png")).toBe(true);
      expect(typeof metadata.id).toBe("string");

      const resolved = store.resolvePath(metadata.storageKey);
      expect(resolved.startsWith(baseDir)).toBe(true);
      expect(resolved).toContain("attachments");
    } finally {
      cleanup();
    }
  });

  it("preserves original bytes", async () => {
    const { store, cleanup } = createTempStore();

    try {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const metadata = await store.storeAttachment({
        name: "image.gif",
        mimeType: "image/gif",
        data,
      });

      const read = await store.readAttachment(metadata.storageKey);
      expect(read).toEqual(data);
    } finally {
      cleanup();
    }
  });

  it("throws when reading a missing attachment", async () => {
    const { store, cleanup } = createTempStore();

    try {
      try {
        await store.readAttachment("00000000-0000-4000-8000-000000000000.png");
        expect(false).toBe(true);
      } catch {
        expect(true).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it("rejects storage keys outside the attachment store", async () => {
    const { store, cleanup } = createTempStore();

    try {
      try {
        store.resolvePath("../workspace.json");
        expect(false).toBe(true);
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).toContain(
          "Invalid attachment storage key",
        );
      }

      try {
        await store.readAttachment("../workspace.json");
        expect(false).toBe(true);
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).toContain(
          "Invalid attachment storage key",
        );
      }
    } finally {
      cleanup();
    }
  });

  it("deletes stored attachments and ignores duplicates", async () => {
    const { store, cleanup } = createTempStore();

    try {
      const metadata = await store.storeAttachment({
        name: "screenshot.png",
        mimeType: "image/png",
        data: new Uint8Array([1, 2, 3]),
      });

      await store.deleteAttachments([metadata.storageKey, metadata.storageKey]);

      expect(existsSync(store.resolvePath(metadata.storageKey))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("treats missing attachment deletion as successful", async () => {
    const { store, cleanup } = createTempStore();

    try {
      await store.deleteAttachments(["missing.png"]);
    } finally {
      cleanup();
    }
  });

  it("validates every storage key before deleting anything", async () => {
    const { store, baseDir, cleanup } = createTempStore();

    try {
      const attachmentsDir = join(baseDir, "attachments");
      const validPath = join(attachmentsDir, "keep.png");
      mkdirSync(attachmentsDir, { recursive: true });
      writeFileSync(validPath, new Uint8Array([1]));

      let error: unknown;
      try {
        await store.deleteAttachments(["keep.png", "../workspace.json"]);
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error ? error.message : String(error)).toContain(
        "Invalid attachment storage key",
      );
      expect(existsSync(validPath)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
