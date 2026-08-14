import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDroppedLocalPaths, revealLocalPath } from "./localPathContext";

describe("Local Path Context privileged boundary", () => {
  it("resolves existing files and directories and rejects missing and non-local entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-local-path-"));
    const filePath = join(root, "My Notes (draft) [v2].md");
    await writeFile(filePath, "hello");

    try {
      expect(
        await resolveDroppedLocalPaths([filePath, join(root, "missing.md"), root, ""]),
      ).toEqual({
        items: [
          {
            path: filePath,
            basename: "My Notes (draft) [v2].md",
            kind: "file",
          },
          {
            path: root,
            basename: root.split("/").at(-1),
            kind: "directory",
          },
        ],
        rejections: [
          { index: 1, reason: "unavailable" },
          { index: 3, reason: "non-local" },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a macOS filename containing a literal backslash without rewriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-local-path-backslash-"));
    const filePath = join(root, String.raw`a\b.md`);
    await writeFile(filePath, "hello");

    try {
      expect(await resolveDroppedLocalPaths([filePath])).toEqual({
        items: [{ path: filePath, basename: String.raw`a\b.md`, kind: "file" }],
        rejections: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reveals only after stat confirms the path still exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-reveal-path-"));
    const filePath = join(root, "notes.md");
    const revealed: string[] = [];
    await writeFile(filePath, "hello");

    try {
      expect(await revealLocalPath(filePath, (path) => revealed.push(path))).toEqual({
        revealed: true,
      });
      expect(revealed).toEqual([filePath]);

      await rm(filePath);
      expect(await revealLocalPath(filePath, (path) => revealed.push(path))).toEqual({
        revealed: false,
        reason: "missing",
      });
      expect(revealed).toEqual([filePath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
