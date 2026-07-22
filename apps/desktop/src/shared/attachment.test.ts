import { describe, expect, it } from "bun:test";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_SINGLE_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  assertValidAttachmentStorageKey,
  classifyAttachmentBytes,
  extensionForMimeType,
  isFileAttachment,
  isImageAttachment,
  isSupportedImageMimeType,
  storageExtensionForAttachment,
  validateAttachmentSelection,
} from "./attachment";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("validateAttachmentSelection", () => {
  it("allows a mixed image/file selection within shared limits", () => {
    const result = validateAttachmentSelection([{ size: 1024 }, { size: 2048 }, { size: 512 }]);

    expect(result.ok).toBe(true);
  });

  it("rejects more than 30 attachments across a mixed selection", () => {
    const files = Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, () => ({ size: 1024 }));

    const result = validateAttachmentSelection(files);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("30 attachments");
  });

  it("rejects a single attachment over 10 MB", () => {
    const result = validateAttachmentSelection([{ size: MAX_SINGLE_ATTACHMENT_BYTES + 1 }]);

    expect(result.ok).toBe(false);
  });

  it("rejects a mixed selection whose total size exceeds 100 MB", () => {
    const result = validateAttachmentSelection([
      { size: MAX_TOTAL_ATTACHMENT_BYTES / 2 + 1 },
      { size: MAX_TOTAL_ATTACHMENT_BYTES / 2 + 1 },
    ]);

    expect(result.ok).toBe(false);
  });
});

describe("classifyAttachmentBytes", () => {
  it("classifies all four supported image MIME types as images", () => {
    for (const mimeType of SUPPORTED_IMAGE_MIME_TYPES) {
      expect(classifyAttachmentBytes({ mimeType, data: new Uint8Array([0, 1, 2]) })).toEqual({
        ok: true,
        kind: "image",
      });
    }
  });

  it("classifies UTF-8 source bytes as files even with an empty MIME type", () => {
    const result = classifyAttachmentBytes({ mimeType: "", data: utf8("const x = 1;\n") });

    expect(result).toEqual({ ok: true, kind: "file" });
  });

  it("classifies UTF-8 bytes with an unknown extension MIME as files", () => {
    const result = classifyAttachmentBytes({
      mimeType: "application/x-unknown",
      data: utf8("# markdown\n"),
    });

    expect(result).toEqual({ ok: true, kind: "file" });
  });

  it("classifies UTF-8 SVG markup as a file, not an image", () => {
    const result = classifyAttachmentBytes({
      mimeType: "image/svg+xml",
      data: utf8("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
    });

    expect(result).toEqual({ ok: true, kind: "file" });
  });

  it("rejects invalid UTF-8 PDF-like binary bytes", () => {
    const result = classifyAttachmentBytes({
      mimeType: "application/pdf",
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x00]),
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("Unsupported file type");
  });

  it("rejects PDF and ZIP files even when their bytes are valid UTF-8", () => {
    expect(
      classifyAttachmentBytes({
        name: "document.pdf",
        mimeType: "application/pdf",
        data: utf8("%PDF-1.4\nplain ascii fixture\n"),
      }).ok,
    ).toBe(false);
    expect(
      classifyAttachmentBytes({
        name: "archive.zip",
        mimeType: "application/octet-stream",
        data: utf8("PK plain ascii fixture"),
      }).ok,
    ).toBe(false);
  });

  it("rejects NUL-containing data that otherwise decodes as UTF-8", () => {
    expect(
      classifyAttachmentBytes({
        name: "binary.dat",
        mimeType: "application/octet-stream",
        data: new Uint8Array([0x61, 0x00, 0x62]),
      }).ok,
    ).toBe(false);
  });
});

describe("storageExtensionForAttachment", () => {
  it("keeps MIME-derived extensions for images", () => {
    expect(
      storageExtensionForAttachment({ kind: "image", name: "photo.png", mimeType: "image/png" }),
    ).toBe("png");
    expect(
      storageExtensionForAttachment({ kind: "image", name: "anim", mimeType: "image/gif" }),
    ).toBe("gif");
  });

  it("preserves a safe original extension for files", () => {
    expect(
      storageExtensionForAttachment({ kind: "file", name: "main.ts", mimeType: "text/plain" }),
    ).toBe("ts");
    expect(
      storageExtensionForAttachment({ kind: "file", name: "notes.MD", mimeType: "text/plain" }),
    ).toBe("md");
  });

  it("falls back to txt for extensionless, unsafe, or long extensions", () => {
    expect(
      storageExtensionForAttachment({ kind: "file", name: "Makefile", mimeType: "text/plain" }),
    ).toBe("txt");
    expect(
      storageExtensionForAttachment({ kind: "file", name: "odd.t@xt", mimeType: "text/plain" }),
    ).toBe("txt");
    expect(
      storageExtensionForAttachment({
        kind: "file",
        name: "data.verylongextension",
        mimeType: "text/plain",
      }),
    ).toBe("txt");
    expect(
      storageExtensionForAttachment({ kind: "file", name: "trailing.", mimeType: "text/plain" }),
    ).toBe("txt");
  });
});

describe("assertValidAttachmentStorageKey", () => {
  it("accepts generated UUID-style keys", () => {
    expect(assertValidAttachmentStorageKey("9b2f-1234.abcd")).toBe("9b2f-1234.abcd");
  });

  it("rejects traversal and separator keys", () => {
    for (const key of ["../secret", "a/../b", "a/b", ".hidden"]) {
      try {
        assertValidAttachmentStorageKey(key);
        expect(false).toBe(true);
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).toContain(
          "Invalid attachment storage key",
        );
      }
    }
  });
});

describe("isSupportedImageMimeType", () => {
  it("returns true for supported image MIME types", () => {
    for (const mimeType of SUPPORTED_IMAGE_MIME_TYPES) {
      expect(isSupportedImageMimeType(mimeType)).toBe(true);
    }
  });

  it("returns false for unsupported MIME types", () => {
    expect(isSupportedImageMimeType("image/svg+xml")).toBe(false);
    expect(isSupportedImageMimeType("application/pdf")).toBe(false);
  });
});

describe("extensionForMimeType", () => {
  it("maps supported MIME types to extensions", () => {
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/webp")).toBe("webp");
    expect(extensionForMimeType("image/gif")).toBe("gif");
  });

  it("falls back to bin for unknown types", () => {
    expect(extensionForMimeType("image/svg+xml")).toBe("bin");
  });
});

describe("attachment kind guards", () => {
  const image = {
    id: "a1",
    kind: "image" as const,
    name: "a.png",
    mimeType: "image/png",
    size: 5,
    storageKey: "a1.png",
  };
  const file = {
    id: "a2",
    kind: "file" as const,
    name: "a.ts",
    mimeType: "text/plain",
    size: 5,
    storageKey: "a2.ts",
  };

  it("isImageAttachment matches only images", () => {
    expect(isImageAttachment(image)).toBe(true);
    expect(isImageAttachment(file)).toBe(false);
  });

  it("isFileAttachment matches only files", () => {
    expect(isFileAttachment(file)).toBe(true);
    expect(isFileAttachment(image)).toBe(false);
  });
});
