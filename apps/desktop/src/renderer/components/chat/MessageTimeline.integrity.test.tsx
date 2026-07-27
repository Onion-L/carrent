import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AttachmentMetadata } from "../../../shared/chat";
import { UserMessageAttachmentList } from "./MessageTimeline";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("historical attachment integrity", () => {
  it("marks each unreadable attachment unavailable without hiding the message content", async () => {
    Object.defineProperty(window, "carrent", {
      configurable: true,
      value: {
        attachments: {
          read: async () => {
            throw new Error("Attachment file is unavailable.");
          },
        },
      },
    });
    const attachments: AttachmentMetadata[] = [
      {
        id: "missing-image",
        kind: "image",
        name: "missing.png",
        mimeType: "image/png",
        size: 10,
        storageKey: "missing.png",
      },
      {
        id: "missing-file",
        kind: "file",
        name: "missing.ts",
        mimeType: "text/plain",
        size: 10,
        storageKey: "missing.ts",
      },
    ];

    await act(async () => {
      root.render(<UserMessageAttachmentList attachments={attachments} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("missing.ts");
    expect(container.textContent?.match(/文件不可用/gu)).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
