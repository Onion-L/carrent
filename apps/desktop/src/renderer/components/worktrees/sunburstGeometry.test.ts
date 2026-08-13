import { describe, expect, it } from "bun:test";
import type {
  WorktreeRecord,
  WorktreeScanResult,
  WorktreeSizeNode,
  WorktreeSizeState,
} from "../../../shared/worktrees";
import {
  aggregateChildren,
  buildSunburstHierarchy,
  describeArcPath,
  layoutSunburst,
  nodeColor,
  repositoryColor,
  REPOSITORY_HUES,
  type SunburstArc,
  type SunburstNode,
} from "./sunburstGeometry";

const TAU = Math.PI * 2;
const EPS = 1e-9;

function makeWorktree(overrides: Partial<WorktreeRecord> & { path: string }): WorktreeRecord {
  return {
    kind: "linked",
    bare: false,
    branch: "feature",
    branchLocal: true,
    detached: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    missing: false,
    dirty: false,
    hasUntracked: false,
    hasSubmodules: false,
    projectNames: [],
    liveRunProjectNames: [],
    runningTerminalProjectNames: [],
    blockingReasons: [],
    cleanupCandidate: true,
    ...overrides,
  };
}

function fileNode(name: string, path: string, bytes: number): WorktreeSizeNode {
  return { name, path, bytes, kind: "file" };
}

function dirNode(
  name: string,
  path: string,
  bytes: number,
  children: WorktreeSizeNode[],
): WorktreeSizeNode {
  return { name, path, bytes, kind: "directory", children };
}

function sizeState(
  bytes: number,
  root: WorktreeSizeNode | null,
  overrides: Partial<WorktreeSizeState> = {},
): WorktreeSizeState {
  return { bytes, incomplete: false, failed: false, root, ...overrides };
}

const REPO_A = "/repos/alpha/.git";
const REPO_B = "/repos/beta/.git";

/** Scan with two repositories plus a non-repository entry that must be skipped. */
function makeScan(): WorktreeScanResult {
  return {
    scannedAt: "2026-08-13T00:00:00.000Z",
    entries: [
      {
        kind: "not-git",
        projectId: "p0",
        projectName: "junk",
        workingDirectory: "/elsewhere",
      },
      {
        kind: "repository",
        commonDirectory: REPO_A,
        projects: ["alpha", "alpha-app"],
        worktrees: [
          makeWorktree({ path: "/repos/alpha", kind: "main", branch: "main" }),
          makeWorktree({ path: "/wt/alpha-feature", branch: "feature" }),
        ],
      },
      {
        kind: "repository",
        commonDirectory: REPO_B,
        projects: ["beta"],
        worktrees: [
          makeWorktree({ path: "/wt/beta-fix", branch: null, detached: true }),
          makeWorktree({ path: "/wt/beta-broken", branch: "broken" }),
          makeWorktree({ path: "/wt/beta-pending", branch: "pending" }),
          makeWorktree({ path: "/wt/beta-empty", branch: "empty" }),
        ],
      },
    ],
  };
}

function makeSizes(): Map<string, WorktreeSizeState> {
  return new Map<string, WorktreeSizeState>([
    // Main worktree: incomplete traversal, one measured file, 150 bytes pruned.
    [
      "/repos/alpha",
      sizeState(
        400,
        dirNode("alpha", "/repos/alpha", 400, [
          fileNode("package.json", "/repos/alpha/package.json", 250),
        ]),
        { incomplete: true },
      ),
    ],
    // Linked worktree: src directory with two files; 100 bytes pruned at the root.
    [
      "/wt/alpha-feature",
      sizeState(
        600,
        dirNode("alpha-feature", "/wt/alpha-feature", 600, [
          dirNode("src", "/wt/alpha-feature/src", 500, [
            fileNode("a.ts", "/wt/alpha-feature/src/a.ts", 300),
            fileNode("b.ts", "/wt/alpha-feature/src/b.ts", 200),
          ]),
        ]),
      ),
    ],
    [
      "/wt/beta-fix",
      sizeState(
        200,
        dirNode("beta-fix", "/wt/beta-fix", 200, [fileNode("x.ts", "/wt/beta-fix/x.ts", 200)]),
      ),
    ],
    // Failed measurement: skipped.
    ["/wt/beta-broken", sizeState(0, null, { failed: true })],
    // "/wt/beta-pending" intentionally has no size entry yet.
    // Cancelled before the root was read: skipped.
    ["/wt/beta-empty", sizeState(0, null)],
  ]);
}

function sunNode(overrides: Partial<SunburstNode> & { id: string }): SunburstNode {
  return {
    name: overrides.id,
    path: null,
    bytes: 0,
    kind: "directory",
    depth: 0,
    incomplete: false,
    children: [],
    ...overrides,
  };
}

describe("buildSunburstHierarchy", () => {
  it("totals the root over included worktree bytes", () => {
    const root = buildSunburstHierarchy(makeScan(), makeSizes(), { includeMainWorktrees: true });
    expect(root).not.toBeNull();
    expect(root?.kind).toBe("root");
    expect(root?.depth).toBe(0);
    expect(root?.bytes).toBe(400 + 600 + 200);
  });

  it("groups worktrees under repository nodes named from projects", () => {
    const root = buildSunburstHierarchy(makeScan(), makeSizes(), { includeMainWorktrees: true });
    expect(root?.children.map((node) => node.id)).toEqual([REPO_A, REPO_B]);

    const repoA = root?.children[0];
    expect(repoA?.kind).toBe("repository");
    expect(repoA?.depth).toBe(1);
    expect(repoA?.name).toBe("alpha, alpha-app");
    expect(repoA?.commonDirectory).toBe(REPO_A);
    expect(repoA?.bytes).toBe(1000);
    expect(repoA?.children.map((node) => node.id)).toEqual(["/repos/alpha", "/wt/alpha-feature"]);
  });

  it("maps directory/file size trees onto worktree children", () => {
    const root = buildSunburstHierarchy(makeScan(), makeSizes(), { includeMainWorktrees: true });
    const worktree = root?.children[0]?.children[1];
    expect(worktree?.kind).toBe("worktree");
    expect(worktree?.depth).toBe(2);
    expect(worktree?.path).toBe("/wt/alpha-feature");
    expect(worktree?.worktree?.branch).toBe("feature");

    const src = worktree?.children[0];
    expect(src).toMatchObject({
      id: "/wt/alpha-feature/src",
      name: "src",
      path: "/wt/alpha-feature/src",
      bytes: 500,
      kind: "directory",
      depth: 3,
    });
    expect(src?.children.map((node) => [node.name, node.kind, node.bytes, node.depth])).toEqual([
      ["a.ts", "file", 300, 4],
      ["b.ts", "file", 200, 4],
    ]);
  });

  it("propagates incomplete onto the worktree node and its subtree", () => {
    const root = buildSunburstHierarchy(makeScan(), makeSizes(), { includeMainWorktrees: true });
    const main = root?.children[0]?.children[0];
    expect(main?.incomplete).toBe(true);
    expect(main?.children[0]?.incomplete).toBe(true);

    const linked = root?.children[0]?.children[1];
    expect(linked?.incomplete).toBe(false);
    expect(linked?.children[0]?.incomplete).toBe(false);
  });

  it("skips failed, missing, and rootless size results", () => {
    const root = buildSunburstHierarchy(makeScan(), makeSizes(), { includeMainWorktrees: true });
    const repoB = root?.children[1];
    expect(repoB?.children.map((node) => node.id)).toEqual(["/wt/beta-fix"]);
    expect(repoB?.bytes).toBe(200);
  });

  it("skips non-repository scan entries", () => {
    const root = buildSunburstHierarchy(makeScan(), makeSizes(), { includeMainWorktrees: true });
    expect(root?.children.some((node) => node.id === "/elsewhere")).toBe(false);
  });

  it("returns null when no measurable worktrees exist", () => {
    const empty: WorktreeScanResult = { entries: [], scannedAt: "2026-08-13T00:00:00.000Z" };
    expect(buildSunburstHierarchy(empty, makeSizes(), { includeMainWorktrees: true })).toBeNull();

    const onlyNonGit: WorktreeScanResult = {
      entries: [
        { kind: "unavailable", projectId: "p1", projectName: "gone", workingDirectory: "/gone" },
      ],
      scannedAt: "2026-08-13T00:00:00.000Z",
    };
    expect(
      buildSunburstHierarchy(onlyNonGit, makeSizes(), { includeMainWorktrees: true }),
    ).toBeNull();

    const scan = makeScan();
    const failedOnly = new Map<string, WorktreeSizeState>([
      ["/repos/alpha", sizeState(0, null, { failed: true })],
      ["/wt/alpha-feature", sizeState(0, null, { failed: true })],
      ["/wt/beta-fix", sizeState(0, null, { failed: true })],
    ]);
    expect(buildSunburstHierarchy(scan, failedOnly, { includeMainWorktrees: true })).toBeNull();
  });

  it("excludes main worktrees without mutating inputs when includeMainWorktrees is false", () => {
    const scan = makeScan();
    const sizes = makeSizes();
    const scanSnapshot = JSON.stringify(scan);
    const sizesSnapshot = JSON.stringify([...sizes.entries()]);

    const root = buildSunburstHierarchy(scan, sizes, { includeMainWorktrees: false });
    expect(root?.bytes).toBe(600 + 200);
    const repoA = root?.children[0];
    expect(repoA?.bytes).toBe(600);
    expect(repoA?.children.map((node) => node.id)).toEqual(["/wt/alpha-feature"]);

    expect(JSON.stringify(scan)).toBe(scanSnapshot);
    expect(JSON.stringify([...sizes.entries()])).toBe(sizesSnapshot);
  });

  it("names a branchless worktree from its path basename", () => {
    const root = buildSunburstHierarchy(makeScan(), makeSizes(), { includeMainWorktrees: true });
    const betaFix = root?.children[1]?.children[0];
    expect(betaFix?.name).toBe("beta-fix");
    const alphaFeature = root?.children[0]?.children[1];
    expect(alphaFeature?.name).toBe("feature");
  });
});

describe("aggregateChildren", () => {
  it("sorts children by bytes desc with a stable name tie-break and does not mutate", () => {
    const parent = sunNode({
      id: "p",
      bytes: 60,
      children: [
        sunNode({ id: "b", name: "b", bytes: 20 }),
        sunNode({ id: "a", name: "a", bytes: 20 }),
        sunNode({ id: "c", name: "c", bytes: 40 }),
      ],
    });
    const originalOrder = parent.children.map((node) => node.id);
    const result = aggregateChildren(parent, { minAngleRatio: 0 });
    expect(result.map((node) => node.id)).toEqual(["c", "a", "b"]);
    expect(parent.children.map((node) => node.id)).toEqual(originalOrder);
  });

  it("folds children beyond maxChildren into an Other node with conserved bytes", () => {
    const children = Array.from({ length: 15 }, (_, index) =>
      sunNode({ id: `c${index}`, name: `c${index}`, bytes: 10 }),
    );
    const parent = sunNode({ id: "p", bytes: 150, children });
    const result = aggregateChildren(parent);
    expect(result).toHaveLength(13);

    const other = result.at(-1);
    expect(other?.kind).toBe("other");
    expect(other?.name).toBe("Other");
    expect(other?.id).toBe("p/__other__");
    expect(other?.bytes).toBe(30);
    expect(result.slice(0, 12).every((node) => node.kind !== "other")).toBe(true);

    const displayed = result.reduce((sum, node) => sum + node.bytes, 0);
    expect(displayed).toBe(parent.bytes);
  });

  it("respects a custom maxChildren", () => {
    const children = Array.from({ length: 6 }, (_, index) =>
      sunNode({ id: `c${index}`, bytes: 5 }),
    );
    const parent = sunNode({ id: "p", bytes: 30, children });
    const result = aggregateChildren(parent, { maxChildren: 4, minAngleRatio: 0 });
    expect(result).toHaveLength(5);
    expect(result.at(-1)?.bytes).toBe(10);
  });

  it("folds children below minAngleRatio of the parent into Other", () => {
    const parent = sunNode({
      id: "p",
      bytes: 1000,
      children: [
        sunNode({ id: "big", bytes: 500 }),
        sunNode({ id: "mid", bytes: 400 }),
        sunNode({ id: "small-a", bytes: 40 }),
        sunNode({ id: "small-b", bytes: 30 }),
      ],
    });
    const result = aggregateChildren(parent, { minAngleRatio: 0.05 });
    expect(result.map((node) => node.id)).toEqual(["big", "mid", "p/__other__"]);
    // 40 + 30 folded, plus the 30-byte pruned gap (children sum to 970 of 1000).
    expect(result.at(-1)?.bytes).toBe(100);
  });

  it("keeps real children when every child is below minAngleRatio", () => {
    // Parent is mostly implicit pruned content; both children are tiny.
    const parent = sunNode({
      id: "p",
      bytes: 10000,
      children: [sunNode({ id: "a", bytes: 10 }), sunNode({ id: "b", bytes: 5 })],
    });
    const result = aggregateChildren(parent, { minAngleRatio: 0.05 });
    expect(result.map((node) => node.id)).toEqual(["a", "b"]);
    expect(result.some((node) => node.kind === "other")).toBe(false);
  });

  it("folds the pruned-bytes gap into Other only when an Other node exists", () => {
    // 14 children of 40 bytes each = 560; parent 1000 -> 440 bytes pruned.
    const children = Array.from({ length: 14 }, (_, index) =>
      sunNode({ id: `c${index}`, bytes: 40 }),
    );
    const withOther = aggregateChildren(sunNode({ id: "p", bytes: 1000, children }));
    const other = withOther.at(-1);
    expect(other?.kind).toBe("other");
    expect(other?.bytes).toBe(80 + 440);
    expect(withOther.reduce((sum, node) => sum + node.bytes, 0)).toBe(1000);

    // Same gap but nothing folded: no synthetic node, the gap stays invisible.
    const withoutOther = aggregateChildren(
      sunNode({ id: "p", bytes: 1000, children: children.slice(0, 5) }),
      { minAngleRatio: 0 },
    );
    expect(withoutOther).toHaveLength(5);
    expect(withoutOther.some((node) => node.kind === "other")).toBe(false);
  });

  it("never replaces all children with Other", () => {
    const parent = sunNode({
      id: "p",
      bytes: 100,
      children: [
        sunNode({ id: "a", bytes: 4 }),
        sunNode({ id: "b", bytes: 3 }),
        sunNode({ id: "c", bytes: 2 }),
        sunNode({ id: "d", bytes: 1 }),
      ],
    });
    // Threshold of 50% is above every child; the largest must survive.
    const result = aggregateChildren(parent, { minAngleRatio: 0.5 });
    expect(result.some((node) => node.id === "a")).toBe(true);
  });

  it("handles zero-byte children without folding", () => {
    const parent = sunNode({
      id: "p",
      bytes: 0,
      children: [sunNode({ id: "a", bytes: 0 }), sunNode({ id: "b", bytes: 0 })],
    });
    const result = aggregateChildren(parent);
    expect(result.map((node) => node.id)).toEqual(["a", "b"]);
  });
});

describe("repositoryColor", () => {
  it("is stable across calls", () => {
    expect(repositoryColor(REPO_A)).toBe(repositoryColor(REPO_A));
    expect(repositoryColor("/repos/gamma/.git")).toBe(repositoryColor("/repos/gamma/.git"));
  });

  it("draws hues from the fixed palette", () => {
    const color = repositoryColor(REPO_A);
    expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    const hue = Number(color.match(/^hsl\((\d+),/)?.[1]);
    expect(REPOSITORY_HUES).toContain(hue);
  });

  it("spreads distinct repositories across distinct palette entries", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((name) =>
        repositoryColor(`/repos/${name}/.git`),
      ),
    );
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});

describe("nodeColor", () => {
  it("gives repository nodes their base color", () => {
    const repo = sunNode({ id: REPO_A, kind: "repository", depth: 1, commonDirectory: REPO_A });
    expect(nodeColor(repo)).toBe(repositoryColor(REPO_A));
  });

  it("gives descendants deterministic related shades that differ from the base", () => {
    const repo = sunNode({ id: REPO_A, kind: "repository", depth: 1, commonDirectory: REPO_A });
    const worktree = sunNode({
      id: "/wt/a",
      kind: "worktree",
      depth: 2,
      commonDirectory: REPO_A,
    });
    const directory = sunNode({
      id: "/wt/a/src",
      kind: "directory",
      depth: 3,
      commonDirectory: REPO_A,
    });
    expect(nodeColor(worktree)).toBe(nodeColor(worktree));
    expect(nodeColor(directory)).toBe(nodeColor(directory));
    expect(nodeColor(worktree)).not.toBe(nodeColor(repo));
    // Related: the descendant hue comes from the same repository palette entry.
    const repoHue = nodeColor(repo).match(/^hsl\((\d+),/)?.[1];
    expect(nodeColor(worktree).startsWith(`hsl(${repoHue},`)).toBe(true);
    expect(nodeColor(directory).startsWith(`hsl(${repoHue},`)).toBe(true);
  });

  it("uses neutral colors for root and other nodes", () => {
    expect(nodeColor(sunNode({ id: "root", kind: "root" }))).toMatch(/^hsl\(/);
    expect(nodeColor(sunNode({ id: "p/__other__", kind: "other" }))).toMatch(/^hsl\(/);
  });
});

/**
 * Root 1000 bytes: A 600 (a1 400 + a2 100, 100 pruned), B 400
 * (13 files of 20 = 260, 140 pruned -> 12 files + Other of 160).
 */
function layoutFixture(): SunburstNode {
  const files = Array.from({ length: 13 }, (_, index) =>
    sunNode({
      id: `/b/f${index}`,
      name: `f${index}`,
      path: `/b/f${index}`,
      bytes: 20,
      kind: "file",
      depth: 2,
    }),
  );
  return sunNode({
    id: "root",
    name: "root",
    kind: "root",
    bytes: 1000,
    depth: 0,
    children: [
      sunNode({
        id: "/a",
        bytes: 600,
        depth: 1,
        children: [
          sunNode({ id: "/a/a1", bytes: 400, depth: 2 }),
          sunNode({ id: "/a/a2", bytes: 100, depth: 2 }),
        ],
      }),
      sunNode({ id: "/b", bytes: 400, depth: 1, children: files }),
    ],
  });
}

function ringKey(arc: SunburstArc): number {
  return Math.round(arc.innerRadius * 1e6);
}

describe("layoutSunburst", () => {
  it("tiles every parent span exactly with its children spans", () => {
    const arcs = layoutSunburst(layoutFixture(), { radius: 100 });
    expect(arcs).toHaveLength(2 + 2 + 13);

    // Outermost ring tiles the full circle.
    const firstRing = arcs.filter((arc) => arc.innerRadius === 0);
    expect(firstRing[0]?.startAngle).toBeCloseTo(0, 9);
    expect(firstRing.at(-1)?.endAngle).toBeCloseTo(TAU, 9);

    for (const parent of arcs) {
      const children = arcs.filter(
        (arc) =>
          Math.abs(arc.innerRadius - parent.outerRadius) < EPS &&
          arc.startAngle >= parent.startAngle - EPS &&
          arc.endAngle <= parent.endAngle + EPS,
      );
      if (children.length === 0) continue;
      expect(children[0]?.startAngle).toBeCloseTo(parent.startAngle, 9);
      expect(children.at(-1)?.endAngle).toBeCloseTo(parent.endAngle, 9);
      for (let index = 1; index < children.length; index += 1) {
        expect(children[index]?.startAngle).toBeCloseTo(children[index - 1]?.endAngle ?? 0, 9);
      }
    }
  });

  it("sizes angles proportionally to bytes within the parent span", () => {
    const arcs = layoutSunburst(layoutFixture(), { radius: 100 });
    const a = arcs.find((arc) => arc.node.id === "/a");
    const b = arcs.find((arc) => arc.node.id === "/b");
    expect((a?.endAngle ?? 0) - (a?.startAngle ?? 0)).toBeCloseTo(0.6 * TAU, 9);
    expect((b?.endAngle ?? 0) - (b?.startAngle ?? 0)).toBeCloseTo(0.4 * TAU, 9);

    // B's Other holds one folded file (20) plus the pruned gap (140).
    const other = arcs.find((arc) => arc.node.kind === "other");
    expect(other?.node.bytes).toBe(160);
    expect((other?.endAngle ?? 0) - (other?.startAngle ?? 0)).toBeCloseTo(0.4 * 0.4 * TAU, 9);
  });

  it("emits finite, ordered, non-overlapping arcs per ring within [0, 2π] and radius", () => {
    const radius = 100;
    const arcs = layoutSunburst(layoutFixture(), { radius });
    const rings = new Map<number, SunburstArc[]>();
    for (const arc of arcs) {
      const ring = rings.get(ringKey(arc)) ?? [];
      ring.push(arc);
      rings.set(ringKey(arc), ring);

      expect(Number.isFinite(arc.startAngle)).toBe(true);
      expect(Number.isFinite(arc.endAngle)).toBe(true);
      expect(arc.startAngle).toBeGreaterThanOrEqual(-EPS);
      expect(arc.endAngle).toBeLessThanOrEqual(TAU + EPS);
      expect(arc.outerRadius).toBeGreaterThan(arc.innerRadius);
      expect(arc.innerRadius).toBeGreaterThanOrEqual(0);
      expect(arc.outerRadius).toBeLessThanOrEqual(radius + EPS);
    }
    for (const ring of rings.values()) {
      for (let index = 1; index < ring.length; index += 1) {
        const previous = ring[index - 1];
        const current = ring[index];
        expect(current?.startAngle ?? 0).toBeGreaterThanOrEqual((previous?.endAngle ?? 0) - EPS);
      }
    }
  });

  it("derives ring thickness from tree depth", () => {
    const arcs = layoutSunburst(layoutFixture(), { radius: 100 });
    // Two levels below the drill root -> thickness 50.
    expect(arcs.some((arc) => arc.innerRadius === 0 && arc.outerRadius === 50)).toBe(true);
    expect(arcs.some((arc) => arc.innerRadius === 50 && arc.outerRadius === 100)).toBe(true);
  });

  it("honors an explicit centerRadius", () => {
    const arcs = layoutSunburst(layoutFixture(), { radius: 110, centerRadius: 10 });
    expect(arcs.every((arc) => arc.innerRadius >= 10 - EPS)).toBe(true);
    expect(arcs.every((arc) => arc.outerRadius <= 110 + EPS)).toBe(true);
  });

  it("returns no arcs when the drill root has zero bytes", () => {
    const root = sunNode({ id: "root", kind: "root", bytes: 0, children: [sunNode({ id: "a" })] });
    expect(layoutSunburst(root, { radius: 100 })).toEqual([]);
  });

  it("returns no arcs when the drill root has no children", () => {
    expect(layoutSunburst(sunNode({ id: "leaf", bytes: 100 }), { radius: 100 })).toEqual([]);
  });

  it("gives a single child the full circle", () => {
    const root = sunNode({
      id: "root",
      kind: "root",
      bytes: 100,
      children: [sunNode({ id: "only", bytes: 100, depth: 1 })],
    });
    const arcs = layoutSunburst(root, { radius: 100 });
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.startAngle).toBeCloseTo(0, 9);
    expect(arcs[0]?.endAngle).toBeCloseTo(TAU, 9);
  });

  it("keeps all-tiny children visible and tiles the full circle with them", () => {
    const root = sunNode({
      id: "root",
      kind: "root",
      bytes: 10000,
      children: [
        sunNode({ id: "a", bytes: 6, depth: 1 }),
        sunNode({ id: "b", bytes: 4, depth: 1 }),
      ],
    });
    const arcs = layoutSunburst(root, { radius: 100 });
    expect(arcs.map((arc) => arc.node.id)).toEqual(["a", "b"]);
    expect(arcs[0]?.startAngle).toBeCloseTo(0, 9);
    expect(arcs.at(-1)?.endAngle).toBeCloseTo(TAU, 9);
  });

  it("stops descending when explicit rings would exceed the radius", () => {
    let node = sunNode({ id: "d5", bytes: 1, depth: 5 });
    for (let depth = 4; depth >= 0; depth -= 1) {
      node = sunNode({ id: `d${depth}`, bytes: 1, depth, children: [node] });
    }
    const arcs = layoutSunburst(node, { radius: 90, ringThickness: 30 });
    expect(arcs).toHaveLength(3);
    expect(arcs.every((arc) => arc.outerRadius <= 90 + EPS)).toBe(true);
  });

  it("recomputes aggregation on drill-down so folded directories become visible", () => {
    const small = sunNode({
      id: "/small",
      name: "small",
      kind: "repository",
      depth: 1,
      bytes: 100,
      commonDirectory: "/small/.git",
      children: [
        sunNode({
          id: "/small/wt",
          kind: "worktree",
          depth: 2,
          bytes: 100,
          commonDirectory: "/small/.git",
          children: [
            sunNode({
              id: "/small/wt/tiny-dir",
              name: "tiny-dir",
              kind: "directory",
              depth: 3,
              bytes: 100,
              commonDirectory: "/small/.git",
            }),
          ],
        }),
      ],
    });
    const big = sunNode({
      id: "/big",
      name: "big",
      kind: "repository",
      depth: 1,
      bytes: 100000,
      commonDirectory: "/big/.git",
    });
    const root = sunNode({ id: "root", kind: "root", bytes: 100100, children: [big, small] });

    const top = layoutSunburst(root, { radius: 100 });
    expect(top.some((arc) => arc.node.id === "/small")).toBe(false);
    expect(top.some((arc) => arc.node.id === "/small/wt/tiny-dir")).toBe(false);
    expect(top.some((arc) => arc.node.kind === "other")).toBe(true);

    const drilled = layoutSunburst(small, { radius: 100 });
    expect(drilled.some((arc) => arc.node.id === "/small/wt")).toBe(true);
    expect(drilled.some((arc) => arc.node.id === "/small/wt/tiny-dir")).toBe(true);
  });

  it("assigns a color to every arc", () => {
    const arcs = layoutSunburst(layoutFixture(), { radius: 100 });
    for (const arc of arcs) {
      expect(arc.color).toMatch(/^hsl\(/);
    }
  });
});

describe("describeArcPath", () => {
  function expectFinitePath(path: string) {
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    const numbers = path.match(/-?\d+(?:\.\d+)?/g) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    for (const value of numbers) {
      expect(Number.isFinite(Number(value))).toBe(true);
    }
  }

  it("builds a finite annular sector path", () => {
    const arcs = layoutSunburst(layoutFixture(), { radius: 100, centerRadius: 20 });
    const arc = arcs.find((candidate) => candidate.node.id === "/a/a1");
    expect(arc).toBeDefined();
    if (arc) expectFinitePath(describeArcPath(arc, { x: 120, y: 120 }));
  });

  it("builds a finite wedge path when the inner radius is zero", () => {
    const arcs = layoutSunburst(layoutFixture(), { radius: 100 });
    const wedge = arcs.find(
      (arc) => arc.innerRadius === 0 && arc.endAngle - arc.startAngle < TAU - EPS,
    );
    expect(wedge).toBeDefined();
    if (wedge) expectFinitePath(describeArcPath(wedge, { x: 0, y: 0 }));
  });

  it("builds a finite path for a full-circle arc", () => {
    const root = sunNode({
      id: "root",
      kind: "root",
      bytes: 100,
      children: [sunNode({ id: "only", bytes: 100, depth: 1 })],
    });
    const [arc] = layoutSunburst(root, { radius: 100, centerRadius: 20 });
    expect(arc).toBeDefined();
    if (arc) expectFinitePath(describeArcPath(arc, { x: 50, y: 50 }));
  });
});
