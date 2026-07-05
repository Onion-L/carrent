import { describe, expect, it } from "bun:test";

import {
  COPY_IMAGE_FEEDBACK_MS,
  copyImageUrlToClipboard,
  createStoredLightboxObjectUrl,
  lightboxToolbarStyle,
} from "./ImageAttachmentLightbox";

describe("ImageAttachmentLightbox", () => {
  it("keeps toolbar controls below the native titlebar hit area", () => {
    expect(lightboxToolbarStyle.paddingTop).toBe("env(titlebar-area-height, 38px)");
  });

  it("keeps toolbar controls clickable in the native titlebar hit area", () => {
    expect(lightboxToolbarStyle.WebkitAppRegion).toBe("no-drag");
  });

  it("keeps copied feedback visible long enough to notice", () => {
    expect(COPY_IMAGE_FEEDBACK_MS).toBe(3000);
  });

  it("revokes a loaded object URL when the effect has been cancelled", async () => {
    const revoked: string[] = [];
    let createdBlobType: string | null = null;

    const url = await createStoredLightboxObjectUrl({
      item: {
        id: "image-1",
        name: "image.png",
        storageKey: "image-1.png",
        mimeType: "image/png",
      },
      readAttachment: async () => new Uint8Array([1, 2, 3]),
      createObjectUrl: (blob) => {
        createdBlobType = blob.type;
        return "blob:cancelled";
      },
      revokeObjectUrl: (objectUrl) => revoked.push(objectUrl),
      isCancelled: () => true,
    });

    expect(url).toBe(null);
    expect(revoked).toEqual(["blob:cancelled"]);
    expect(createdBlobType).toBe("image/png");
  });

  it("allows a later load after an earlier cancelled load", async () => {
    let createCount = 0;
    const revoked: string[] = [];
    const item = {
      id: "image-1",
      name: "image.png",
      storageKey: "image-1.png",
      mimeType: "image/png",
    };

    const firstUrl = await createStoredLightboxObjectUrl({
      item,
      readAttachment: async () => new Uint8Array([1]),
      createObjectUrl: () => `blob:${++createCount}`,
      revokeObjectUrl: (objectUrl) => revoked.push(objectUrl),
      isCancelled: () => true,
    });
    const secondUrl = await createStoredLightboxObjectUrl({
      item,
      readAttachment: async () => new Uint8Array([1]),
      createObjectUrl: () => `blob:${++createCount}`,
      revokeObjectUrl: (objectUrl) => revoked.push(objectUrl),
      isCancelled: () => false,
    });

    expect(firstUrl).toBe(null);
    expect(secondUrl).toBe("blob:2");
    expect(revoked).toEqual(["blob:1"]);
  });

  it("copies an image URL to the clipboard", async () => {
    const clipboardPayloads: Record<string, Blob>[] = [];
    let writtenCount = 0;

    await copyImageUrlToClipboard({
      url: "blob:image",
      fetchBlob: async (url) => {
        expect(url).toBe("blob:image");
        return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      },
      createClipboardItem: (items) => {
        clipboardPayloads.push(items);
        return items as unknown as ClipboardItem;
      },
      writeClipboard: async (items) => {
        writtenCount = items.length;
      },
    });

    expect(writtenCount).toBe(1);
    expect(Object.keys(clipboardPayloads[0])).toEqual(["image/png"]);
    expect(clipboardPayloads[0]["image/png"].type).toBe("image/png");
  });

  it("uses a concrete clipboard MIME type when the source blob is generic", async () => {
    const clipboardPayloads: Record<string, Blob>[] = [];

    await copyImageUrlToClipboard({
      url: "blob:image",
      fetchBlob: async () => new Blob([new Uint8Array([1])], { type: "image/*" }),
      createClipboardItem: (items) => {
        clipboardPayloads.push(items);
        return items as unknown as ClipboardItem;
      },
      writeClipboard: async () => {},
    });

    expect(Object.keys(clipboardPayloads[0])).toEqual(["image/png"]);
    expect(clipboardPayloads[0]["image/png"].type).toBe("image/png");
  });
});
