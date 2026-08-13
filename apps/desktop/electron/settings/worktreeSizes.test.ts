import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorktreeSizeEvent, WorktreeSizeState } from "../../src/shared/worktrees";
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
  });

  it("counts nested .git entries as ordinary content", async () => {
    const worktree = join(root, "wt");
    mkdirSync(join(worktree, "submodule"), { recursive: true });
    write(join(worktree, "submodule"), ".git", "gitdir: ../../.git/modules/submodule");
    write(worktree, "src.txt", "content");

    const result = await sizeOf(worktree);
    expect(result.bytes).toBe(
      Buffer.byteLength("content") + Buffer.byteLength("gitdir: ../../.git/modules/submodule"),
    );
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
    } finally {
      chmodSync(worktree, 0o755);
    }
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
        () => resolvePending({ bytes: 0, incomplete: false, failed: true }),
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

    gate.pending[0].resolve({ bytes: 1, incomplete: false, failed: false });
    await gate.pending[0].promise;
    expect(gate.pending).toHaveLength(2);

    gate.pending[1].resolve({ bytes: 2, incomplete: false, failed: false });
    await gate.pending[1].promise;
    expect(gate.pending).toHaveLength(3);

    gate.pending[2].resolve({ bytes: 3, incomplete: false, failed: false });
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

    gate.pending[1].resolve({ bytes: 1, incomplete: false, failed: false });
    await gate.pending[1].promise;
    gate.pending[2].resolve({ bytes: 2, incomplete: false, failed: false });
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
    gate.pending[1].resolve({ bytes: 1, incomplete: false, failed: false });
    await gate.pending[1].promise;
    gate.pending[2].resolve({ bytes: 2, incomplete: false, failed: false });
    await gate.pending[2].promise;

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.generation === second.generation)).toBe(true);
  });
});
