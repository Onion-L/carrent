/**
 * Sunburst geometry for the Worktrees Settings Tab storage chart. Pure
 * data-to-geometry functions: no React, no DOM, no IPC. The panel composes
 * its own rendering from the arcs returned here.
 *
 * Pruned-bytes convention: the size tree omits small files, so a node's
 * `bytes` may exceed the sum of its children's. The difference is implicit
 * content of the parent. Aggregation never synthesizes a node for that gap
 * on its own; but when folding does create an "Other" node, the gap is
 * added to Other's bytes so displayed bytes conserve the parent total.
 */

import type {
  WorktreeRecord,
  WorktreeScanResult,
  WorktreeSizeNode,
  WorktreeSizeState,
} from "../../../shared/worktrees";

export type SunburstNode = {
  /** Stable path-based identity; synthetic Other nodes use `<parentId>/__other__`. */
  id: string;
  name: string;
  path: string | null;
  bytes: number;
  kind: "root" | "repository" | "worktree" | "directory" | "file" | "other";
  depth: number;
  /** The underlying size measurement was a lower bound (unreadable entries). */
  incomplete: boolean;
  worktree?: WorktreeRecord;
  commonDirectory?: string;
  children: SunburstNode[];
};

export type SunburstArc = {
  node: SunburstNode;
  /** Radians, 0 at 12 o'clock, clockwise; within [0, 2π]. */
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  color: string;
};

export type AggregateOptions = {
  /** Maximum real children kept before the rest fold into Other. Default 12. */
  maxChildren?: number;
  /**
   * Children whose share of the parent bytes is below this ratio of a full
   * circle fold into Other. Default 0.02 (2%, ≈7.2°). Only applies when at
   * least one child is at or above the threshold, and the single largest
   * child always survives, so Other can never replace every child.
   */
  minAngleRatio?: number;
};

export const DEFAULT_MAX_CHILDREN = 12;
export const DEFAULT_MIN_ANGLE_RATIO = 0.02;

/** Id of the synthetic hierarchy root node. */
export const ROOT_NODE_ID = "root";

/** Fixed palette of eight hues; repository identity hashes into it. */
export const REPOSITORY_HUES: readonly number[] = [210, 150, 25, 280, 340, 100, 190, 55];

const TAU = Math.PI * 2;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function basename(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

function mapSizeTree(
  node: WorktreeSizeNode,
  depth: number,
  incomplete: boolean,
  commonDirectory: string,
): SunburstNode {
  return {
    id: node.path,
    name: node.name,
    path: node.path,
    bytes: node.bytes,
    kind: node.kind,
    depth,
    incomplete,
    commonDirectory,
    children: (node.children ?? []).map((child) =>
      mapSizeTree(child, depth + 1, incomplete, commonDirectory),
    ),
  };
}

/**
 * Builds the sunburst hierarchy: root (total scanned storage) → repository →
 * worktree → directory/file. Entries without a usable size measurement
 * (pending, failed, or rootless) are skipped, as are non-repository scan
 * entries and — with `includeMainWorktrees: false` — main worktrees. Returns
 * null when no measurable worktree exists. Inputs are never mutated.
 */
export function buildSunburstHierarchy(
  scan: WorktreeScanResult,
  sizes: ReadonlyMap<string, WorktreeSizeState>,
  options: { includeMainWorktrees: boolean },
): SunburstNode | null {
  const repositories: SunburstNode[] = [];

  for (const entry of scan.entries) {
    if (entry.kind !== "repository") continue;

    const worktrees: SunburstNode[] = [];
    for (const worktree of entry.worktrees) {
      if (!options.includeMainWorktrees && worktree.kind === "main") continue;
      const size = sizes.get(worktree.path);
      if (!size || size.failed || size.root === null) continue;

      worktrees.push({
        id: worktree.path,
        name: worktree.branch ?? basename(worktree.path),
        path: worktree.path,
        bytes: size.bytes,
        kind: "worktree",
        depth: 2,
        incomplete: size.incomplete,
        worktree,
        commonDirectory: entry.commonDirectory,
        children: (size.root.children ?? []).map((child) =>
          mapSizeTree(child, 3, size.incomplete, entry.commonDirectory),
        ),
      });
    }

    if (worktrees.length === 0) continue;
    repositories.push({
      id: entry.commonDirectory,
      name: entry.projects.length > 0 ? entry.projects.join(", ") : entry.commonDirectory,
      path: entry.commonDirectory,
      bytes: worktrees.reduce((sum, node) => sum + node.bytes, 0),
      kind: "repository",
      depth: 1,
      incomplete: worktrees.some((node) => node.incomplete),
      commonDirectory: entry.commonDirectory,
      children: worktrees,
    });
  }

  if (repositories.length === 0) return null;
  return {
    id: ROOT_NODE_ID,
    name: "All worktrees",
    path: null,
    bytes: repositories.reduce((sum, node) => sum + node.bytes, 0),
    kind: "root",
    depth: 0,
    incomplete: repositories.some((node) => node.incomplete),
    children: repositories,
  };
}

/**
 * Returns the children to display for a node, sorted by bytes descending
 * (ties by name). Children past `maxChildren` and children below
 * `minAngleRatio` of the parent fold into a single synthetic "Other" node
 * (`<parentId>/__other__`). The pruned-bytes gap (`node.bytes` minus the sum
 * of tree children) is added to Other's bytes when Other exists; otherwise
 * the gap stays invisible. Min-angle folding never removes the largest
 * child and only applies when at least one child clears the threshold, so
 * Other never replaces every child. Returns a new array; inputs untouched.
 */
export function aggregateChildren(
  node: SunburstNode,
  options: AggregateOptions = {},
): SunburstNode[] {
  const maxChildren = options.maxChildren ?? DEFAULT_MAX_CHILDREN;
  const minAngleRatio = options.minAngleRatio ?? DEFAULT_MIN_ANGLE_RATIO;

  const sorted = [...node.children].sort(
    (a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  if (sorted.length === 0) return [];

  const kept = sorted.slice(0, Math.max(1, maxChildren));
  const folded = sorted.slice(Math.max(1, maxChildren));

  if (node.bytes > 0 && minAngleRatio > 0) {
    const threshold = minAngleRatio * node.bytes;
    const anyAbove = sorted.some((child) => child.bytes >= threshold);
    if (anyAbove) {
      const survivors: SunburstNode[] = [];
      for (const child of kept) {
        // The largest child always survives, even below the threshold.
        if (child.bytes >= threshold || survivors.length === 0) survivors.push(child);
        else folded.push(child);
      }
      kept.length = 0;
      kept.push(...survivors);
    }
  }

  if (folded.length === 0) return kept;

  const childSum = node.children.reduce((sum, child) => sum + child.bytes, 0);
  const prunedGap = Math.max(0, node.bytes - childSum);
  const otherBytes = folded.reduce((sum, child) => sum + child.bytes, 0) + prunedGap;
  const other: SunburstNode = {
    id: `${node.id}/__other__`,
    name: "Other",
    path: null,
    bytes: otherBytes,
    kind: "other",
    depth: node.depth + 1,
    incomplete: node.incomplete,
    commonDirectory: node.commonDirectory,
    children: [],
  };
  return [...kept, other];
}

/** Stable base color for a repository: FNV-1a hash of its identity → palette hue. */
export function repositoryColor(commonDirectory: string): string {
  const hue = REPOSITORY_HUES[fnv1a(commonDirectory) % REPOSITORY_HUES.length] ?? 0;
  return `hsl(${hue}, 70%, 55%)`;
}

/**
 * Color for a node. Repository nodes get their base color; descendants get a
 * related shade — same repository hue, saturation stepping down and lightness
 * stepping up with depth, plus a small deterministic variation from the node
 * id so siblings differ. Root and Other are neutral. Colors never encode
 * safety state.
 */
export function nodeColor(node: SunburstNode): string {
  if (node.kind === "repository" && node.commonDirectory) {
    return repositoryColor(node.commonDirectory);
  }
  if (node.kind === "root") return "hsl(0, 0%, 45%)";
  if (node.kind === "other" || !node.commonDirectory) return "hsl(0, 0%, 60%)";

  const hue = REPOSITORY_HUES[fnv1a(node.commonDirectory) % REPOSITORY_HUES.length] ?? 0;
  const depthStep = Math.max(0, node.depth - 1);
  const variation = fnv1a(node.id) % 3;
  const saturation = Math.max(30, 68 - depthStep * 9);
  const lightness = Math.min(82, 52 + depthStep * 7 + variation * 3);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Lays out the descendants of `root` (the drill root itself is not drawn) as
 * annular arcs. Aggregation runs per displayed node, so passing a deeper
 * drill root recomputes folding relative to it. Each ring's children are
 * sized by their share of the parent's bytes within the parent's angle. When
 * the size tree was pruned (children sum to less than the parent) and no
 * Other node folded the gap, the remainder of the parent span stays EMPTY —
 * children never inflate beyond their true share. When aggregation did create
 * an Other node its bytes include the gap, so the span tiles fully.
 *
 * Ring thickness defaults to the available radial space divided by the tree
 * depth below the drill root. With an explicit `ringThickness`, descent
 * stops at the deepest ring that still fits inside `radius`. Returns [] when
 * the drill root has zero bytes or no children (caller shows an empty state).
 */
export function layoutSunburst(
  root: SunburstNode,
  options: { radius: number; ringThickness?: number; centerRadius?: number },
): SunburstArc[] {
  const { radius } = options;
  const centerRadius = options.centerRadius ?? 0;
  if (!Number.isFinite(radius) || radius <= centerRadius || root.bytes <= 0) return [];

  let maxDepth = 0;
  const measure = (node: SunburstNode, depth: number) => {
    if (depth > maxDepth) maxDepth = depth;
    for (const child of node.children) measure(child, depth + 1);
  };
  measure(root, 0);
  if (maxDepth === 0) return [];

  const ringThickness = options.ringThickness ?? (radius - centerRadius) / maxDepth;
  if (!(ringThickness > 0)) return [];
  const maxRings = Math.floor((radius - centerRadius) / ringThickness + 1e-9);
  if (maxRings < 1) return [];

  const arcs: SunburstArc[] = [];
  const visit = (node: SunburstNode, startAngle: number, endAngle: number, ring: number) => {
    if (ring >= maxRings) return;
    const children = aggregateChildren(node);
    const total = children.reduce((sum, child) => sum + child.bytes, 0);
    if (total <= 0) return;

    const span = endAngle - startAngle;
    let cursor = startAngle;
    children.forEach((child, index) => {
      const childStart = cursor;
      // The last child closes the parent span exactly, avoiding drift.
      const childEnd =
        index === children.length - 1 ? endAngle : cursor + (child.bytes / total) * span;
      cursor = childEnd;
      const innerRadius = centerRadius + ring * ringThickness;
      arcs.push({
        node: child,
        startAngle: childStart,
        endAngle: childEnd,
        innerRadius,
        outerRadius: innerRadius + ringThickness,
        color: nodeColor(child),
      });
      visit(child, childStart, childEnd, ring + 1);
    });
  };
  visit(root, 0, TAU, 0);
  return arcs;
}

/**
 * SVG path for one annular sector. Angles follow the layout convention
 * (0 at 12 o'clock, clockwise). Full-circle spans are split into two half
 * arcs because a single SVG arc cannot describe 360°.
 */
export function describeArcPath(arc: SunburstArc, center: { x: number; y: number }): string {
  const { innerRadius, outerRadius, startAngle, endAngle } = arc;
  const span = endAngle - startAngle;
  const point = (r: number, angle: number) =>
    `${(center.x + r * Math.sin(angle)).toFixed(2)},${(center.y - r * Math.cos(angle)).toFixed(2)}`;

  if (span >= TAU - 1e-6) {
    const mid = startAngle + span / 2;
    if (innerRadius <= 0) {
      return (
        `M${point(outerRadius, startAngle)}` +
        ` A${outerRadius.toFixed(2)},${outerRadius.toFixed(2)} 0 1 1 ${point(outerRadius, mid)}` +
        ` A${outerRadius.toFixed(2)},${outerRadius.toFixed(2)} 0 1 1 ${point(outerRadius, startAngle)}` +
        ` Z`
      );
    }
    return (
      `M${point(outerRadius, startAngle)}` +
      ` A${outerRadius.toFixed(2)},${outerRadius.toFixed(2)} 0 1 1 ${point(outerRadius, mid)}` +
      ` A${outerRadius.toFixed(2)},${outerRadius.toFixed(2)} 0 1 1 ${point(outerRadius, startAngle)}` +
      ` L${point(innerRadius, startAngle)}` +
      ` A${innerRadius.toFixed(2)},${innerRadius.toFixed(2)} 0 1 0 ${point(innerRadius, mid)}` +
      ` A${innerRadius.toFixed(2)},${innerRadius.toFixed(2)} 0 1 0 ${point(innerRadius, startAngle)}` +
      ` Z`
    );
  }

  const largeArc = span > Math.PI ? 1 : 0;
  if (innerRadius <= 0) {
    return (
      `M${center.x.toFixed(2)},${center.y.toFixed(2)}` +
      ` L${point(outerRadius, startAngle)}` +
      ` A${outerRadius.toFixed(2)},${outerRadius.toFixed(2)} 0 ${largeArc} 1 ${point(outerRadius, endAngle)}` +
      ` Z`
    );
  }
  return (
    `M${point(outerRadius, startAngle)}` +
    ` A${outerRadius.toFixed(2)},${outerRadius.toFixed(2)} 0 ${largeArc} 1 ${point(outerRadius, endAngle)}` +
    ` L${point(innerRadius, endAngle)}` +
    ` A${innerRadius.toFixed(2)},${innerRadius.toFixed(2)} 0 ${largeArc} 0 ${point(innerRadius, startAngle)}` +
    ` Z`
  );
}
