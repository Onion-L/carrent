import { describe, expect, it } from "bun:test";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_SINGLE_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  extensionForMimeType,
  isSupportedImageMimeType,
  validateImageAttachments,
} from "./imageAttachment";

function makeFile(type: string, size: number) {
  return { type, size, name: "image" };
}

describe("validateImageAttachments", () => {
  it("allows supported images within limits", () => {
    const result = validateImageAttachments([
      makeFile("image/png", 1024),
      makeFile("image/jpeg", 2048),
    ]);

    expect(result.ok).toBe(true);
  });

  it("rejects unsupported formats", () => {
    const result = validateImageAttachments([makeFile("application/pdf", 1024)]);

    expect(result.ok).toBe(false);
    expect(!result.ok && typeof result.reason).toBe("string");
  });

  it("rejects more than 30 images", () => {
    const files = Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, () =>
      makeFile("image/png", 1024),
    );

    const result = validateImageAttachments(files);

    expect(result.ok).toBe(false);
  });

  it("rejects a single image over 10 MB", () => {
    const result = validateImageAttachments([
      makeFile("image/png", MAX_SINGLE_ATTACHMENT_BYTES + 1),
    ]);

    expect(result.ok).toBe(false);
  });

  it("rejects total size over 100 MB", () => {
    const result = validateImageAttachments([
      makeFile("image/png", MAX_TOTAL_ATTACHMENT_BYTES / 2 + 1),
      makeFile("image/jpeg", MAX_TOTAL_ATTACHMENT_BYTES / 2 + 1),
    ]);

    expect(result.ok).toBe(false);
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
