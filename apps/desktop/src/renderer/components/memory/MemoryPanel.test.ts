import { describe, expect, it } from "bun:test";

import type { KimiMemoryIndex } from "../../../shared/kimiMemory";
import { deleteKimiMemoryEntry, readKimiMemoryIndex } from "./MemoryPanel";

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
