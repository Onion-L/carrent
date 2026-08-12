import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { KimiMemoryFile, KimiMemoryIndex } from "../../../shared/kimiMemory";
import {
  MemoryPanelView,
  deleteKimiMemoryEntry,
  readKimiMemoryIndex,
  type KimiMemorySettingsApi,
} from "./MemoryPanel";

function makeIndex(): KimiMemoryIndex {
  return {
    projects: [
      {
        key: "-Users-onion-workbench-carrent-17e396ae3d2e",
        name: "carrent",
        files: [
          {
            path: "/tmp/memory/user-role.md",
            fileName: "user-role.md",
            name: "user-role",
            description: "Who the user is",
            type: "user",
            body: "Staff engineer.\n",
            raw: "---\nname: user-role\ntype: user\n---\nStaff engineer.\n",
            modifiedAt: 1786519619762,
            isIndex: false,
          },
        ],
      },
    ],
    scannedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("readKimiMemoryIndex", () => {
  it("returns a restart hint when the current preload does not expose kimi memory", async () => {
    const result = await readKimiMemoryIndex({});

    expect(result.index).toBe(null);
    expect(result.error).toContain("Restart Carrent");
  });

  it("returns the index from the preload API when available", async () => {
    const index = makeIndex();
    const result = await readKimiMemoryIndex({ kimiMemory: async () => index });

    expect(result.error).toBe(null);
    expect(result.index).toBe(index);
  });

  it("returns the error message when the preload call rejects", async () => {
    const result = await readKimiMemoryIndex({
      kimiMemory: async () => {
        throw new Error("scan failed");
      },
    });

    expect(result.index).toBe(null);
    expect(result.error).toBe("scan failed");
  });
});

describe("deleteKimiMemoryEntry", () => {
  it("returns a restart hint when the preload does not expose delete", async () => {
    const error = await deleteKimiMemoryEntry({}, "/tmp/memory/a.md");

    expect(error).toContain("Restart Carrent");
  });

  it("passes the path through and returns null on success", async () => {
    const deleted: string[] = [];
    const error = await deleteKimiMemoryEntry(
      {
        kimiMemoryDelete: async (filePath) => {
          deleted.push(filePath);
        },
      },
      "/tmp/memory/a.md",
    );

    expect(error).toBe(null);
    expect(deleted).toEqual(["/tmp/memory/a.md"]);
  });

  it("returns the error message when the delete call rejects", async () => {
    const error = await deleteKimiMemoryEntry(
      {
        kimiMemoryDelete: async () => {
          throw new Error("permission denied");
        },
      },
      "/tmp/memory/a.md",
    );

    expect(error).toBe("permission denied");
  });
});

function makeFile(overrides: Partial<KimiMemoryFile>): KimiMemoryFile {
  return {
    path: "/tmp/memory/file.md",
    fileName: "file.md",
    name: "file",
    description: "",
    type: "other",
    body: "body text\n",
    raw: "body text\n",
    modifiedAt: 1786519619762,
    isIndex: false,
    ...overrides,
  };
}

function makeUiIndex(): KimiMemoryIndex {
  return {
    projects: [
      {
        key: "-Users-onion-workbench-carrent-17e396ae3d2e",
        name: "carrent",
        files: [
          makeFile({
            path: "/tmp/memory/MEMORY.md",
            fileName: "MEMORY.md",
            name: "MEMORY",
            isIndex: true,
            body: "# Memory Index\n",
            raw: '# Memory Index\n\n- [user-role](user-role.md) — Who the user is\n',
          }),
          makeFile({
            path: "/tmp/memory/user-role.md",
            fileName: "user-role.md",
            name: "user-role",
            description: "Who the user is",
            type: "user",
            body: "Staff engineer.\n",
            raw: "---\nname: user-role\ntype: user\n---\nStaff engineer.\n",
          }),
        ],
      },
      {
        key: "-Users-onion-workbench-other-abcdef123456",
        name: "other",
        files: [
          makeFile({
            path: "/tmp/other/notes.md",
            fileName: "notes.md",
            name: "notes",
            type: "project",
          }),
        ],
      },
    ],
    scannedAt: "2026-08-12T00:00:00.000Z",
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderPanel(
  apiOverrides: Partial<KimiMemorySettingsApi> = {},
  shellApi: { revealPath?: (filePath: string) => Promise<unknown> } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(MemoryPanelView, {
        api: { kimiMemory: async () => makeUiIndex(), ...apiOverrides },
        shellApi,
      }),
    );
  });
  return container;
}

function findButton(rootElement: HTMLElement, text: string): HTMLButtonElement {
  const button = [...rootElement.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("MemoryPanel UI", () => {
  it("groups files by project and selects the first file by default", async () => {
    const c = await renderPanel();

    expect(c.textContent).toContain("carrent");
    expect(c.textContent).toContain("other");
    expect(c.textContent).toContain("user-role");
    expect(c.textContent).toContain("notes");
    expect(c.querySelector(".border-b")?.textContent).toContain("MEMORY.md");
  });

  it("switches the detail pane when another row is clicked", async () => {
    const c = await renderPanel();
    const row = [...c.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("user-role"),
    );
    if (!row) throw new Error("row not found");

    await click(row);

    expect(c.querySelector(".border-b")?.textContent).toContain("user-role.md");
  });

  it("shows the full file with line numbers in raw mode", async () => {
    const c = await renderPanel();
    const row = [...c.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("user-role"),
    );
    if (!row) throw new Error("row not found");
    await click(row);
    await click(findButton(c, "Raw"));

    const body = c.textContent ?? "";
    expect(body).toContain("name: user-role");
    expect(body).toContain("Staff engineer.");
    const lineNumbers = [...c.querySelectorAll("span")].map((span) => span.textContent);
    expect(lineNumbers).toContain("1");
    expect(lineNumbers).toContain("2");
  });

  it("toggles between preview and raw", async () => {
    const c = await renderPanel();

    await click(findButton(c, "Raw"));
    expect(c.textContent).toContain("[user-role](user-role.md)");

    await click(findButton(c, "Preview"));
    expect(c.querySelector("h1")?.textContent).toBe("Memory Index");
  });

  it("shows the empty state when there is no memory", async () => {
    const c = await renderPanel({
      kimiMemory: async () => ({ projects: [], scannedAt: "2026-08-12T00:00:00.000Z" }),
    });

    expect(c.textContent).toContain("No Kimi Code memory yet");
  });

  it("surfaces a reveal failure as an inline error", async () => {
    const c = await renderPanel(
      {},
      {
        revealPath: async () => {
          throw new Error("reveal failed");
        },
      },
    );
    const revealButton = c.querySelector('button[aria-label="Reveal MEMORY.md in Finder"]');
    if (!revealButton) throw new Error("reveal button not found");

    await click(revealButton);

    expect(c.textContent).toContain("reveal failed");
  });

  it("confirms before deleting and refreshes afterwards", async () => {
    const deleted: string[] = [];
    let listCalls = 0;
    const c = await renderPanel({
      kimiMemory: async () => {
        listCalls += 1;
        return makeUiIndex();
      },
      kimiMemoryDelete: async (filePath) => {
        deleted.push(filePath);
      },
    });
    const deleteButton = c.querySelector('button[aria-label="Delete MEMORY.md"]');
    if (!deleteButton) throw new Error("delete button not found");

    await click(deleteButton);
    expect(c.textContent).toContain("Delete memory file");

    await click(findButton(c, "Delete"));

    expect(deleted).toEqual(["/tmp/memory/MEMORY.md"]);
    expect(listCalls).toBe(2);
    expect(c.textContent).not.toContain("Delete memory file");
  });
});

describe("MemoryPanel delete selection", () => {
  it("selects the next surviving file instead of resurrecting the deleted one", async () => {
    let deleted = false;
    const c = await renderPanel({
      kimiMemory: async () => {
        const index = makeUiIndex();
        if (deleted) {
          index.projects[0]!.files = index.projects[0]!.files.filter(
            (file) => file.fileName !== "MEMORY.md",
          );
        }
        return index;
      },
      kimiMemoryDelete: async () => {
        deleted = true;
      },
    });
    expect(c.querySelector(".border-b")?.textContent).toContain("MEMORY.md");

    const deleteButton = c.querySelector('button[aria-label="Delete MEMORY.md"]');
    if (!deleteButton) throw new Error("delete button not found");
    await click(deleteButton);
    await click(findButton(c, "Delete"));

    expect(c.querySelector(".border-b")?.textContent).toContain("user-role.md");
    expect(c.querySelector(".border-b")?.textContent).not.toContain("MEMORY.md");
  });

  it("shows the placeholder when the last file is deleted", async () => {
    let deleted = false;
    const c = await renderPanel({
      kimiMemory: async () => {
        if (deleted) return { projects: [], scannedAt: "2026-08-12T00:00:00.000Z" };
        return {
          projects: [
            {
              key: "-tmp-solo",
              name: "solo",
              files: [makeFile({ path: "/tmp/solo.md", fileName: "solo.md", name: "solo" })],
            },
          ],
          scannedAt: "2026-08-12T00:00:00.000Z",
        };
      },
      kimiMemoryDelete: async () => {
        deleted = true;
      },
    });
    const deleteButton = c.querySelector('button[aria-label="Delete solo.md"]');
    if (!deleteButton) throw new Error("delete button not found");
    await click(deleteButton);
    await click(findButton(c, "Delete"));

    expect(c.textContent).toContain("No Kimi Code memory yet");
  });
});
