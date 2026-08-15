import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openLocalPath, resolveDroppedLocalPaths, revealLocalPath } from "./localPathContext";

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

describe("openLocalPath privileged boundary", () => {
  function createOpener() {
    const opened: string[] = [];
    const open = async (path: string) => {
      opened.push(path);
      return "";
    };
    return { opened, open };
  }

  it("opens a regular file with its resolved realpath", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-open-path-"));
    const { opened, open } = createOpener();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "notes.txt"), "hello");
    await symlink(join(root, "real"), join(root, "link"));

    try {
      expect(await openLocalPath(join(root, "link", "notes.txt"), open)).toBe("");
      expect(opened).toEqual([await realpath(join(root, "real", "notes.txt"))]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("opens a plain directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-open-dir-"));
    const { opened, open } = createOpener();

    try {
      expect(await openLocalPath(root, open)).toBe("");
      expect(opened).toEqual([await realpath(root)]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an application bundle directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-open-app-"));
    const { opened, open } = createOpener();
    await mkdir(join(root, "Something.app"));

    try {
      expect((await openLocalPath(join(root, "Something.app"), open)).length).toBeGreaterThan(0);
      expect(opened).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses launchable and shortcut file extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-open-ext-"));
    const { opened, open } = createOpener();
    await writeFile(join(root, "installer.exe"), "MZ");
    await writeFile(join(root, "shortcut.lnk"), "L");

    try {
      expect((await openLocalPath(join(root, "installer.exe"), open)).length).toBeGreaterThan(0);
      expect((await openLocalPath(join(root, "shortcut.lnk"), open)).length).toBeGreaterThan(0);
      expect(opened).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses scripts with an executable bit on POSIX", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "carrent-open-exec-"));
    const { opened, open } = createOpener();
    const filePath = join(root, "run.sh");
    await writeFile(filePath, "#!/bin/sh\n");
    await chmod(filePath, 0o755);

    try {
      expect((await openLocalPath(filePath, open)).length).toBeGreaterThan(0);
      expect(opened).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("opens a non-executable script", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-open-script-"));
    const { opened, open } = createOpener();
    const filePath = join(root, "run.sh");
    await writeFile(filePath, "#!/bin/sh\n");

    try {
      expect(await openLocalPath(filePath, open)).toBe("");
      expect(opened).toEqual([await realpath(filePath)]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses relative, empty, and missing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "carrent-open-missing-"));
    const { opened, open } = createOpener();

    try {
      expect((await openLocalPath("notes.txt", open)).length).toBeGreaterThan(0);
      expect((await openLocalPath("", open)).length).toBeGreaterThan(0);
      expect((await openLocalPath(join(root, "missing.txt"), open)).length).toBeGreaterThan(0);
      expect(opened).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("judges a symlinked file by its realpath target", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "carrent-open-symlink-"));
    const { opened, open } = createOpener();
    await writeFile(join(root, "malware.exe"), "MZ");
    await symlink(join(root, "malware.exe"), join(root, "innocent.txt"));

    try {
      expect((await openLocalPath(join(root, "innocent.txt"), open)).length).toBeGreaterThan(0);
      expect(opened).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
