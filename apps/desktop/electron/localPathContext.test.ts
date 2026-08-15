import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDroppedLocalPaths, revealLocalPath } from "./localPathContext";

describe("Local Path Context privileged boundary", () => {
  it("resolves files and directories and rejects missing, non-local, and device entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-local-path-"));
    const filePath = join(root, "My Notes (draft) [v2].md");
    await writeFile(filePath, "hello");

    try {
      expect(
        await resolveDroppedLocalPaths([filePath, join(root, "missing.md"), root, "", "/dev/null"]),
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
          { index: 4, reason: "unsupported-kind" },
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
    const resolvedFilePath = await realpath(filePath);

    try {
      expect(await revealLocalPath(filePath, (path) => revealed.push(path))).toEqual({
        revealed: true,
      });
      expect(revealed).toEqual([resolvedFilePath]);

      await rm(filePath);
      expect(await revealLocalPath(filePath, (path) => revealed.push(path))).toEqual({
        revealed: false,
        reason: "missing",
      });
      expect(revealed).toEqual([resolvedFilePath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reveals executable files and application bundles without opening them", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-reveal-executable-"));
    const executablePath = join(root, "control-panel.cpl");
    const bundlePath = join(root, "Something.app");
    const revealed: string[] = [];
    await writeFile(executablePath, "payload");
    await mkdir(bundlePath);

    try {
      expect(await revealLocalPath(executablePath, (path) => revealed.push(path))).toEqual({
        revealed: true,
      });
      expect(await revealLocalPath(bundlePath, (path) => revealed.push(path))).toEqual({
        revealed: true,
      });
      expect(revealed).toEqual([await realpath(executablePath), await realpath(bundlePath)]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reveals a symlink target by its realpath", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "carrent-reveal-symlink-"));
    const targetPath = join(root, "target.txt");
    const symlinkPath = join(root, "link.txt");
    const revealed: string[] = [];
    await writeFile(targetPath, "hello");
    await symlink(targetPath, symlinkPath);

    try {
      expect(await revealLocalPath(symlinkPath, (path) => revealed.push(path))).toEqual({
        revealed: true,
      });
      expect(revealed).toEqual([await realpath(targetPath)]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
