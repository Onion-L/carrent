import { describe, expect, it } from "bun:test";
import {
  fileAttachmentIconKind,
  formatAttachmentSize,
  metadataOnly,
  pendingAttachmentFromFile,
  pendingImageAttachments,
  stripLocalPath,
} from "./attachments";

function makeFile(name: string, type: string): File {
  return new File(["bytes"], name, { type });
}

describe("pendingAttachmentFromFile", () => {
  it("creates a pending image with a preview URL", () => {
    const file = makeFile("test.png", "image/png");
    const pending = pendingAttachmentFromFile(file);

    expect(pending.file).toBe(file);
    expect(pending.previewUrl).toBeString();
    expect(pending.metadata).toBeUndefined();
  });

  it("does not create a preview URL for a pending file", () => {
    const file = makeFile("main.ts", "text/plain");
    const pending = pendingAttachmentFromFile(file);

    expect(pending.previewUrl).toBeUndefined();
  });

  it("does not create a preview URL when stored metadata says file", () => {
    const file = makeFile("vector.svg", "image/svg+xml");
    const metadata = {
      id: "a1",
      kind: "file" as const,
      name: "vector.svg",
      mimeType: "text/plain",
      size: 5,
      storageKey: "a1.svg",
    };
    const pending = pendingAttachmentFromFile(file, metadata);

    expect(pending.previewUrl).toBeUndefined();
    expect(pending.metadata).toEqual(metadata);
  });

  it("includes image metadata when provided", () => {
    const file = makeFile("test.png", "image/png");
    const metadata = {
      id: "a1",
      kind: "image" as const,
      name: "test.png",
      mimeType: "image/png",
      size: 5,
      storageKey: "a1.png",
    };
    const pending = pendingAttachmentFromFile(file, metadata);

    expect(pending.previewUrl).toBeString();
    expect(pending.metadata).toEqual(metadata);
  });

  it("falls back to the file type when legacy metadata has no kind", () => {
    const file = makeFile("test.png", "image/png");
    const legacyMetadata = {
      id: "a1",
      name: "test.png",
      mimeType: "image/png",
      size: 5,
      storageKey: "a1.png",
    } as unknown as Parameters<typeof pendingAttachmentFromFile>[1];
    const pending = pendingAttachmentFromFile(file, legacyMetadata);

    expect(pending.previewUrl).toBeString();
  });
});

describe("pendingImageAttachments", () => {
  it("keeps mixed pending order and filters lightbox items to images", () => {
    const imageA = pendingAttachmentFromFile(makeFile("a.png", "image/png"));
    const fileB = pendingAttachmentFromFile(makeFile("b.ts", "text/plain"));
    const imageC = pendingAttachmentFromFile(makeFile("c.gif", "image/gif"));
    const pending = [imageA, fileB, imageC];

    const images = pendingImageAttachments(pending);

    expect(images).toEqual([imageA, imageC]);
    expect(images.indexOf(imageA)).toBe(0);
    expect(images.indexOf(imageC)).toBe(1);
  });
});

describe("formatAttachmentSize", () => {
  it("formats bytes, KB, and MB deterministically", () => {
    expect(formatAttachmentSize(0)).toBe("0 B");
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(1023)).toBe("1023 B");
    expect(formatAttachmentSize(1024)).toBe("1 KB");
    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
    expect(formatAttachmentSize(1024 * 1024)).toBe("1 MB");
    expect(formatAttachmentSize(3.25 * 1024 * 1024)).toBe("3.3 MB");
  });
});

describe("fileAttachmentIconKind", () => {
  it("picks the code icon for code-like extensions", () => {
    expect(fileAttachmentIconKind("main.ts")).toBe("code");
    expect(fileAttachmentIconKind("config.JSON")).toBe("code");
    expect(fileAttachmentIconKind("script.py")).toBe("code");
  });

  it("picks the text icon for other or missing extensions", () => {
    expect(fileAttachmentIconKind("notes.md")).toBe("text");
    expect(fileAttachmentIconKind("Makefile")).toBe("text");
    expect(fileAttachmentIconKind("trailing.")).toBe("text");
  });
});

describe("stripLocalPath", () => {
  it("removes localPath from an attachment object", () => {
    const attachment = {
      id: "a1",
      kind: "image",
      name: "test.png",
      mimeType: "image/png",
      size: 5,
      storageKey: "a1.png",
      localPath: "/tmp/a1.png",
    };

    const result = stripLocalPath(attachment);

    expect("localPath" in result).toBe(false);
    expect(result).toEqual({
      id: "a1",
      kind: "image",
      name: "test.png",
      mimeType: "image/png",
      size: 5,
      storageKey: "a1.png",
    });
  });
});

describe("metadataOnly", () => {
  it("strips localPath from every attachment", () => {
    const attachments = [
      {
        id: "a1",
        kind: "image" as const,
        name: "one.png",
        mimeType: "image/png",
        size: 5,
        storageKey: "a1.png",
        localPath: "/tmp/a1.png",
      },
      {
        id: "a2",
        kind: "image" as const,
        name: "two.png",
        mimeType: "image/png",
        size: 5,
        storageKey: "a2.png",
        localPath: "/tmp/a2.png",
      },
    ];

    const result = metadataOnly(attachments);

    expect(result).toHaveLength(2);
    expect(result.every((item) => !("localPath" in item))).toBe(true);
  });
});
