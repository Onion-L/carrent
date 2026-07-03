import { describe, expect, it } from "bun:test";
import { metadataOnly, pendingAttachmentFromFile, stripLocalPath } from "./imageAttachments";

function makeFile(name: string, type: string): File {
  return new File(["bytes"], name, { type });
}

describe("pendingAttachmentFromFile", () => {
  it("creates a pending attachment with a preview URL", () => {
    const file = makeFile("test.png", "image/png");
    const pending = pendingAttachmentFromFile(file);

    expect(pending.file).toBe(file);
    expect(pending.previewUrl).toBeString();
    expect(pending.metadata).toBeUndefined();
  });

  it("includes metadata when provided", () => {
    const file = makeFile("test.png", "image/png");
    const metadata = {
      id: "a1",
      name: "test.png",
      mimeType: "image/png",
      size: 5,
      storageKey: "a1.png",
    };
    const pending = pendingAttachmentFromFile(file, metadata);

    expect(pending.metadata).toEqual(metadata);
  });
});

describe("stripLocalPath", () => {
  it("removes localPath from an attachment object", () => {
    const attachment = {
      id: "a1",
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
        name: "one.png",
        mimeType: "image/png",
        size: 5,
        storageKey: "a1.png",
        localPath: "/tmp/a1.png",
      },
      {
        id: "a2",
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
