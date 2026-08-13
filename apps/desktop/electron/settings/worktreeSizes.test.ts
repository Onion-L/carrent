import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorktreeSizeEvent, WorktreeSizeNode, WorktreeSizeState } from "../../src/shared/worktrees";
import { createWorktreeSizeScanner, measureWorktreeDirectorySize } from "./worktreeSizes";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "carrent-worktree-sizes-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function sizeOf(path: string): Promise<WorktreeSizeState> {
  return measureWorktreeDirectorySize({ path, signal: new AbortController().signal });
}

function writeSized(dir: string, name: string, bytes: number): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(bytes));
  return path;
}

function childOf(node: WorktreeSizeNode, name: string): WorktreeSizeNode {
  const child = node.children?.find((candidate) => candidate.name === name);
  expect(child).toBeDefined();
  return child as WorktreeSizeNode;
}

function fileNodesOf(node: WorktreeSizeNode): WorktreeSizeNode[] {
  return (node.children ?? []).filter((child) => child.kind === "file");
}

/** Sum of every descendant file-node byte; symlinks never become nodes. */
function leafBytesOf(node: WorktreeSizeNode): number {
  if (node.kind === "file") return node.bytes;
  return (node.children ?? []).reduce((total, child) => total + leafBytesOf(child), 0);
}

describe("measureWorktreeDirectorySize", () => {
  it("counts regular, hidden, ignored, and nested files without reading contents", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, "node_modules", "dep"), { recursive: true });
    write(worktree, "README.md", "tracked");
    write(worktree, ".hidden", "hidden");
    write(join(worktree, "node_modules"), "ignored.txt", "ignored");
    write(join(worktree, "node_modules", "dep"), "index.js", "dep");

    const result = await sizeOf(worktree);
    const expected =
      Buffer.byteLength("tracked") +
      Buffer.byteLength("hidden") +
      Buffer.byteLength("ignored") +
      Buffer.byteLength("dep");
    expect(result.bytes).toBe(expected);
    expect(result.incomplete).toBe(false);
    expect(result.failed).toBe(false);
  });

  it("excludes the Git control entry at the worktree root", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, ".git", "objects"), { recursive: true });
    write(join(worktree, ".git"), "HEAD", "ref: refs/heads/main");
    write(join(worktree, ".git", "objects"), "blob.bin", "git internals");
    write(worktree, "src.txt", "content");

    const result = await sizeOf(worktree);
    expect(result.bytes).toBe(Buffer.byteLength("content"));
    // The root `.git` entry is absent from the tree as well.
    expect(result.root?.children?.some((child) => child.name === ".git") ?? false).toBe(false);
  });

  it("counts nested .git entries as ordinary content", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, "submodule"), { recursive: true });
    writeSized(join(worktree, "submodule"), ".git", 64 * 1024);
    write(worktree, "src.txt", "content");

    const result = await sizeOf(worktree);
    expect(result.bytes).toBe(Buffer.byteLength("content") + 64 * 1024);
    const submodule = childOf(result.root as WorktreeSizeNode, "submodule");
    const nested = childOf(submodule, ".git");
    expect(nested.kind).toBe("file");
    expect(nested.bytes).toBe(64 * 1024);
  });

  it("never follows symbolic links and counts only the link entry", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, "dir"), { recursive: true });
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    write(outside, "big.bin", "x".repeat(64 * 1024));
    symlinkSync(outside, join(worktree, "dir", "linked"));
    // Self-referencing link must not create a traversal cycle.
    symlinkSync(join(worktree, "dir"), join(worktree, "dir", "loop"));
    write(worktree, "src.txt", "content");

    const result = await sizeOf(worktree);
    const linkBytes = readdirSync(join(worktree, "dir"), { withFileTypes: true })
      .filter((entry) => entry.isSymbolicLink())
      .reduce((total, entry) => total + lstatSync(join(worktree, "dir", entry.name)).size, 0);
    // Two link entries counted, none of the outside content.
    expect(result.bytes).toBe(Buffer.byteLength("content") + linkBytes);
    expect(result.bytes).toBeLessThan(64 * 1024);
    // Links contribute bytes to their directory but never become nodes.
    const dir = childOf(result.root as WorktreeSizeNode, "dir");
    expect(dir.bytes).toBe(linkBytes);
    expect(dir.children ?? []).toEqual([]);
  });

  it("marks the measurement incomplete when a subtree is unreadable", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, "locked"), { recursive: true });
    write(join(worktree, "locked"), "secret.txt", "secret");
    write(worktree, "src.txt", "content");
    chmodSync(join(worktree, "locked"), 0o000);

    try {
      const result = await sizeOf(worktree);
      expect(result.incomplete).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.bytes).toBe(Buffer.byteLength("content"));
      // The unreadable subtree stays in the tree as an empty directory node.
      expect(result.root).not.toBe(null);
      const locked = childOf(result.root as WorktreeSizeNode, "locked");
      expect(locked.kind).toBe("directory");
      expect(locked.bytes).toBe(0);
      expect(locked.children).toBeUndefined();
    } finally {
      chmodSync(join(worktree, "locked"), 0o755);
    }
  });

  it("marks the measurement failed when the root is unreadable", async () => {
    const worktree = join(root, "wt");
    mkdirSync(worktree, { recursive: true });
    write(worktree, "src.txt", "content");
    chmodSync(worktree, 0o000);

    try {
      const result = await sizeOf(worktree);
      expect(result.failed).toBe(true);
      expect(result.incomplete).toBe(false);
      expect(result.bytes).toBe(0);
      expect(result.root).toBe(null);
    } finally {
      chmodSync(worktree, 0o755);
    }
  });

  it("builds a size tree for nested directories and large files", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, "sub", "inner"), { recursive: true });
    writeSized(worktree, "big.bin", 64 * 1024);
    writeSized(join(worktree, "sub"), "deeper.bin", 64 * 1024);
    writeSized(join(worktree, "sub", "inner"), "leaf.bin", 64 * 1024);

    const result = await sizeOf(worktree);
    const total = 3 * 64 * 1024;
    expect(result.bytes).toBe(total);
    expect(result.failed).toBe(false);

    const tree = result.root as WorktreeSizeNode;
    expect(tree).not.toBe(null);
    expect(tree.name).toBe("wt");
    expect(tree.path).toBe(worktree);
    expect(tree.kind).toBe("directory");
    expect(tree.bytes).toBe(result.bytes);

    const big = childOf(tree, "big.bin");
    expect(big).toEqual({
      name: "big.bin",
      path: join(worktree, "big.bin"),
      bytes: 64 * 1024,
      kind: "file",
    });

    const sub = childOf(tree, "sub");
    expect(sub.kind).toBe("directory");
    expect(sub.path).toBe(join(worktree, "sub"));
    expect(sub.bytes).toBe(2 * 64 * 1024);
    expect(childOf(sub, "deeper.bin").bytes).toBe(64 * 1024);

    const inner = childOf(sub, "inner");
    expect(inner.kind).toBe("directory");
    expect(inner.bytes).toBe(64 * 1024);
    expect(childOf(inner, "leaf.bin").kind).toBe("file");

    // Bytes conservation: leaf file nodes sum to the tree total (no links here).
    expect(leafBytesOf(tree)).toBe(tree.bytes);
  });

  it("omits small files from the tree while keeping their bytes", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, "empty"), { recursive: true });
    mkdirSync(join(worktree, "sub"), { recursive: true });
    write(worktree, "small.txt", "small");
    write(join(worktree, "sub"), "tiny.txt", "tiny");

    const result = await sizeOf(worktree);
    expect(result.bytes).toBe(Buffer.byteLength("small") + Buffer.byteLength("tiny"));

    const tree = result.root as WorktreeSizeNode;
    expect(tree.bytes).toBe(result.bytes);
    // No file nodes anywhere below the threshold.
    expect(fileNodesOf(tree)).toEqual([]);
    const sub = childOf(tree, "sub");
    expect(fileNodesOf(sub)).toEqual([]);
    expect(sub.bytes).toBe(Buffer.byteLength("tiny"));
    // Empty directories omit `children` entirely.
    const empty = childOf(tree, "empty");
    expect(empty.kind).toBe("directory");
    expect(empty.bytes).toBe(0);
    expect(empty.children).toBeUndefined();
  });

  it("raises the file threshold to 0.5% of the total for large worktrees", async () => {
    const worktree = join(root, "wt");
    mkdirSync(worktree, { recursive: true });
    // Anchor file pushes 0.5% of the total above the 64 KiB floor.
    writeSized(worktree, "anchor.bin", 16 * 1024 * 1024);
    writeSized(worktree, "mid.bin", 80 * 1024);
    writeSized(worktree, "kept.bin", 128 * 1024);

    const result = await sizeOf(worktree);
    const total = 16 * 1024 * 1024 + 80 * 1024 + 128 * 1024;
    expect(result.bytes).toBe(total);
    // Sanity: the relative leg really is the binding one here.
    expect(0.005 * total).toBeGreaterThan(64 * 1024);
    expect(80 * 1024).toBeLessThan(0.005 * total);

    const tree = result.root as WorktreeSizeNode;
    const fileNames = fileNodesOf(tree).map((node) => node.name);
    expect(fileNames.sort()).toEqual(["anchor.bin", "kept.bin"]);
    expect(tree.bytes).toBe(total);
  });
});

describe("createWorktreeSizeScanner", () => {
  // A measure double whose promise the test resolves explicitly, so
  // cancellation and supersession are deterministic without wall-clock waits.
  function gatedMeasure() {
    const pending: Array<{
      signal: AbortSignal;
      promise: Promise<WorktreeSizeState>;
      resolve: (state: WorktreeSizeState) => void;
    }> = [];
    const measure = (input: { path: string; signal: AbortSignal }): Promise<WorktreeSizeState> => {
      let resolvePending: (state: WorktreeSizeState) => void = () => {};
      const promise = new Promise<WorktreeSizeState>((resolve) => {
        resolvePending = resolve;
      });
      input.signal.addEventListener(
        "abort",
        () => resolvePending({ bytes: 0, incomplete: false, failed: true, root: null }),
        { once: true },
      );
      pending.push({ signal: input.signal, promise, resolve: resolvePending });
      return promise;
    };
    return { measure, pending };
  }


  function targets(count: number) {
    return Array.from({ length: count }, (_value, index) => ({
      commonDirectory: "/repo/.git",
      worktreePath: `/repo/wt-${index}`,
    }));
  }

  it("publishes progressive per-worktree results with overall progress", async () => {
    const events: WorktreeSizeEvent[] = [];
    const gate = gatedMeasure();
    const scanner = createWorktreeSizeScanner({
      measure: gate.measure,
      publish: (_owner, event) => events.push(event),
    });

    const { generation } = scanner.start(7, targets(3));
    expect(gate.pending).toHaveLength(1);

    gate.pending[0].resolve({ bytes: 1, incomplete: false, failed: false, root: null });
    await gate.pending[0].promise;
    expect(gate.pending).toHaveLength(2);

    gate.pending[1].resolve({ bytes: 2, incomplete: false, failed: false, root: null });
    await gate.pending[1].promise;
    expect(gate.pending).toHaveLength(3);

    gate.pending[2].resolve({ bytes: 3, incomplete: false, failed: false, root: null });
    await gate.pending[2].promise;

    expect(events.map((event) => event.generation)).toEqual([generation, generation, generation]);
    expect(events.map((event) => [event.worktreePath, event.completed, event.total])).toEqual([
      ["/repo/wt-0", 1, 3],
      ["/repo/wt-1", 2, 3],
      ["/repo/wt-2", 3, 3],
    ]);
    expect(events.map((event) => event.result.bytes)).toEqual([1, 2, 3]);
  });

  it("cancels the current run before it can publish", async () => {
    const events: WorktreeSizeEvent[] = [];
    const gate = gatedMeasure();
    const scanner = createWorktreeSizeScanner({
      measure: gate.measure,
      publish: (_owner, event) => events.push(event),
    });

    const { generation } = scanner.start(7, targets(3));
    expect(gate.pending).toHaveLength(1);
    scanner.cancel(generation);
    await gate.pending[0].promise;

    // The aborted run never starts the next measurement and publishes nothing.
    expect(gate.pending).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it("supersedes the previous run when a new start arrives", async () => {
    const events: WorktreeSizeEvent[] = [];
    const gate = gatedMeasure();
    const scanner = createWorktreeSizeScanner({
      measure: gate.measure,
      publish: (_owner, event) => events.push(event),
    });

    const first = scanner.start(7, targets(3));
    const firstPending = gate.pending[0];
    const second = scanner.start(7, targets(2));
    await firstPending.promise;
    expect(first.generation).not.toBe(second.generation);
    expect(gate.pending).toHaveLength(2);

    gate.pending[1].resolve({ bytes: 1, incomplete: false, failed: false, root: null });
    await gate.pending[1].promise;
    gate.pending[2].resolve({ bytes: 2, incomplete: false, failed: false, root: null });
    await gate.pending[2].promise;

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.generation === second.generation)).toBe(true);
  });

  it("ignores cancellation of a stale generation", async () => {
    const events: WorktreeSizeEvent[] = [];
    const gate = gatedMeasure();
    const scanner = createWorktreeSizeScanner({
      measure: gate.measure,
      publish: (_owner, event) => events.push(event),
    });

    const first = scanner.start(7, targets(2));
    const second = scanner.start(7, targets(2));
    scanner.cancel(first.generation);

    expect(gate.pending).toHaveLength(2);
    gate.pending[1].resolve({ bytes: 1, incomplete: false, failed: false, root: null });
    await gate.pending[1].promise;
    gate.pending[2].resolve({ bytes: 2, incomplete: false, failed: false, root: null });
    await gate.pending[2].promise;

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.generation === second.generation)).toBe(true);
  });
});
