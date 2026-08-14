import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
  LocalPathContextItem,
  LocalPathResolutionResult,
} from "../../../shared/localPathContext";
import { ToastProvider } from "../toast/ToastContext";
import { ConversationDropSurface, useConversationDropTarget } from "./ConversationDropSurface";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let resolvedFileBatches: File[][] = [];

// Stands in for the active Composer: registers composition callbacks without
// rendering the full editor, so drop behavior is testable in isolation.
function DropTargetHarness({
  onLocalPathItems,
  onImageFiles,
}: {
  onLocalPathItems: (items: LocalPathContextItem[]) => void;
  onImageFiles: (files: File[]) => void;
}) {
  useConversationDropTarget({ onLocalPathItems, onImageFiles });
  return null;
}

async function renderSurface(
  resolveDroppedItems: (files: File[]) => Promise<LocalPathResolutionResult> = async (files) => ({
    items: files.map((file) => ({
      path: `/Users/test/${file.name}`,
      basename: file.name,
      kind: "file" as const,
    })),
    rejections: [],
  }),
  target?: {
    onLocalPathItems: (items: LocalPathContextItem[]) => void;
    onImageFiles: (files: File[]) => void;
  },
) {
  resolvedFileBatches = [];
  window.carrent = {
    localPaths: {
      resolveDroppedItems: async (files: File[]) => {
        resolvedFileBatches.push(files);
        return resolveDroppedItems(files);
      },
    },
  } as unknown as Window["carrent"];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <ToastProvider>
        <ConversationDropSurface>
          {target ? <DropTargetHarness {...target} /> : null}
        </ConversationDropSurface>
      </ToastProvider>,
    );
  });
}

async function dispatchFileDrag(
  type: "dragenter" | "dragleave" | "dragover" | "drop",
  files: File[],
  types = ["Files"],
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      items: files.map(() => ({ kind: "file" })),
      types,
    },
  });
  await act(async () => {
    container!.querySelector<HTMLElement>("[data-local-path-drop-surface]")!.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return event;
}

function errorToasts() {
  return [...container!.querySelectorAll('[role="alert"]')];
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("ConversationDropSurface", () => {
  it("keeps the overlay active across nested dragenter and dragleave events", async () => {
    await renderSurface();
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });

    const enter = await dispatchFileDrag("dragenter", [file]);
    expect(enter.defaultPrevented).toBe(true);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    await dispatchFileDrag("dragenter", [file]);
    await dispatchFileDrag("dragleave", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    await dispatchFileDrag("dragleave", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("leaves text and URL drags untouched", async () => {
    await renderSurface();
    const browserImage = new File(["image"], "remote.png", { type: "image/png" });

    const event = await dispatchFileDrag(
      "dragover",
      [browserImage],
      ["Files", "text/uri-list", "text/html"],
    );

    expect(event.defaultPrevented).toBe(false);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("ignores nested dragleave events from non-filesystem drags", async () => {
    await renderSurface();
    const file = new File([], "notes.md");

    await dispatchFileDrag("dragenter", [file]);
    await dispatchFileDrag("dragleave", [file], ["Files", "text/uri-list", "text/html"]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    await dispatchFileDrag("dragleave", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("clears a stuck overlay when the drag ends without a final dragleave", async () => {
    await renderSurface();
    const file = new File([], "notes.md");

    await dispatchFileDrag("dragenter", [file]);
    await dispatchFileDrag("dragenter", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();

    await dispatchFileDrag("dragenter", [file]);
    expect(container!.querySelector("[data-local-path-drop-overlay]")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("drop", { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector("[data-local-path-drop-overlay]")).toBeNull();
  });

  it("delivers resolved items to the active target in drop order", async () => {
    const resolved: LocalPathContextItem[][] = [];
    await renderSurface(
      async () => ({
        items: [
          { path: "/Users/test/docs/references", basename: "references", kind: "directory" },
          { path: "/Users/test/a/report.md", basename: "report.md", kind: "file" },
          { path: "/Users/test/b/report.md", basename: "report.md", kind: "file" },
        ],
        rejections: [],
      }),
      {
        onLocalPathItems: (items) => resolved.push(items),
        onImageFiles: () => {},
      },
    );

    const drop = await dispatchFileDrag("drop", [
      new File([], "references"),
      new File([], "report.md"),
      new File([], "report.md"),
    ]);

    expect(drop.defaultPrevented).toBe(true);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.map((item) => item.path)).toEqual([
      "/Users/test/docs/references",
      "/Users/test/a/report.md",
      "/Users/test/b/report.md",
    ]);
  });

  it("routes dropped images to the image callback and resolves only the remaining items", async () => {
    const receivedImages: File[][] = [];
    const receivedItems: LocalPathContextItem[][] = [];
    await renderSurface(undefined, {
      onLocalPathItems: (items) => receivedItems.push(items),
      onImageFiles: (files) => receivedImages.push(files),
    });
    const image = new File(["fake-png"], "carrent-usage.png", { type: "image/png" });
    const notes = new File(["hello"], "notes.md", { type: "text/markdown" });

    await dispatchFileDrag("drop", [image, notes]);

    expect(receivedImages).toHaveLength(1);
    expect(receivedImages[0]!.map((file) => file.name)).toEqual(["carrent-usage.png"]);
    // Only the non-image files reach privileged resolution.
    expect(resolvedFileBatches).toHaveLength(1);
    expect(resolvedFileBatches[0]!.map((file) => file.name)).toEqual(["notes.md"]);
    expect(receivedItems).toHaveLength(1);
    expect(receivedItems[0]!.map((item) => item.basename)).toEqual(["notes.md"]);
  });

  it("shows one error toast and delivers nothing when every dropped item is rejected", async () => {
    const receivedItems: LocalPathContextItem[][] = [];
    await renderSurface(
      async () => ({
        items: [],
        rejections: [{ index: 0, reason: "unavailable" }],
      }),
      {
        onLocalPathItems: (items) => receivedItems.push(items),
        onImageFiles: () => {},
      },
    );

    await dispatchFileDrag("drop", [new File(["hello"], "missing.md")]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    expect(
      errorToasts().filter((alert) =>
        alert.textContent?.includes("One dropped item is not an available local file or folder."),
      ),
    ).toHaveLength(1);
    expect(receivedItems).toEqual([[]]);
  });

  it("keeps valid items from a partially rejected drop and shows one error toast", async () => {
    const receivedItems: LocalPathContextItem[][] = [];
    await renderSurface(
      async () => ({
        items: [
          { path: "/Users/test/kept.md", basename: "kept.md", kind: "file" },
          { path: "/Users/test/assets", basename: "assets", kind: "directory" },
        ],
        rejections: [{ index: 1, reason: "unsupported-kind" }],
      }),
      {
        onLocalPathItems: (items) => receivedItems.push(items),
        onImageFiles: () => {},
      },
    );

    await dispatchFileDrag("drop", [
      new File([], "kept.md"),
      new File([], "special.sock"),
      new File([], "assets"),
    ]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    expect(receivedItems).toHaveLength(1);
    expect(receivedItems[0]!.map((item) => item.path)).toEqual([
      "/Users/test/kept.md",
      "/Users/test/assets",
    ]);
    expect(
      errorToasts().filter((alert) =>
        alert.textContent?.includes("One dropped item is not an available local file or folder."),
      ),
    ).toHaveLength(1);
  });

  it("shows an error toast when privileged resolution fails", async () => {
    await renderSurface(
      async () => {
        throw new Error("bridge is down");
      },
      { onLocalPathItems: () => {}, onImageFiles: () => {} },
    );

    await dispatchFileDrag("drop", [new File(["hello"], "notes.md")]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    expect(
      errorToasts().filter((alert) =>
        alert.textContent?.includes("The dropped local file or folder could not be resolved."),
      ),
    ).toHaveLength(1);
  });

  it("stops delivering drops to a target that has unmounted", async () => {
    const receivedItems: LocalPathContextItem[][] = [];
    await renderSurface(undefined, {
      onLocalPathItems: (items) => receivedItems.push(items),
      onImageFiles: () => {},
    });

    await act(async () => {
      root!.render(
        <ToastProvider>
          <ConversationDropSurface>{null}</ConversationDropSurface>
        </ToastProvider>,
      );
    });

    await dispatchFileDrag("drop", [new File(["hello"], "notes.md")]);
    expect(receivedItems).toEqual([]);
  });
});
