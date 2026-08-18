import { describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import { createProjectPathAllowlist } from "./projectPathAllowlist";

function snapshotWithProjects(...workingDirectories: string[]) {
  const snapshot = createEmptyAppStateSnapshot();
  snapshot.projects = workingDirectories.map((workingDirectory, index) => ({
    id: `project-${index}`,
    name: `Project ${index}`,
    workingDirectory,
  }));
  return snapshot;
}

function makeTempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "carrent-allowlist-")));
}

async function captureRejectionMessage(action: () => Promise<void>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected the action to throw.");
}

describe("createProjectPathAllowlist", () => {
  it("allows a registered project directory and paths nested inside it", async () => {
    const root = makeTempDir();
    try {
      const assert = createProjectPathAllowlist({
        getSnapshot: () => snapshotWithProjects(root),
      });

      await assert(root);
      await assert(join(root, "nested", "deeper"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows a not-yet-created descendant of an existing project", async () => {
    const root = makeTempDir();
    try {
      const assert = createProjectPathAllowlist({
        getSnapshot: () => snapshotWithProjects(root),
      });

      await assert(join(root, "created-later"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects paths outside every registered project", async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    try {
      const assert = createProjectPathAllowlist({
        getSnapshot: () => snapshotWithProjects(root),
      });

      expect(await captureRejectionMessage(() => assert(outside))).toBe(
        "Project path is outside registered Carrent Projects.",
      );
      // A sibling sharing the root's prefix is not contained by it.
      expect(await captureRejectionMessage(() => assert(`${root}-suffix`))).toBe(
        "Project path is outside registered Carrent Projects.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects relative paths", async () => {
    const assert = createProjectPathAllowlist({
      getSnapshot: () => snapshotWithProjects("/tmp/project"),
    });

    expect(await captureRejectionMessage(() => assert("relative/project"))).toBe(
      "Project path must be absolute.",
    );
  });

  it("rejects everything when no snapshot or no projects are registered", async () => {
    const root = makeTempDir();
    try {
      const noSnapshot = createProjectPathAllowlist({
        getSnapshot: () => null,
      });
      const emptySnapshot = createProjectPathAllowlist({
        getSnapshot: () => createEmptyAppStateSnapshot(),
      });

      expect(await captureRejectionMessage(() => noSnapshot(root))).toBe(
        "Project path is outside registered Carrent Projects.",
      );
      expect(await captureRejectionMessage(() => emptySnapshot(root))).toBe(
        "Project path is outside registered Carrent Projects.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlink that escapes its project", async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    try {
      try {
        symlinkSync(outside, join(root, "escape"));
      } catch {
        // Creating a directory symlink needs elevated privileges on Windows;
        // the realpath-based containment itself is platform-independent.
        return;
      }
      const assert = createProjectPathAllowlist({
        getSnapshot: () => snapshotWithProjects(root),
      });

      expect(await captureRejectionMessage(() => assert(join(root, "escape")))).toBe(
        "Project path is outside registered Carrent Projects.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
