/**
 * Interactive sunburst storage chart for the Worktrees Settings Tab. Geometry
 * comes from sunburstGeometry; this component only renders arcs and routes
 * interactions. Drill state and the repository/worktree selection are lifted
 * into WorktreesPanelView so the worktree list and the chart stay in sync:
 * list clicks drill the chart, and activating a repository/worktree sector
 * selects the matching list row.
 *
 * Cleanup actions intentionally stay list-only; the chart never mutates.
 */

import { useMemo, useState } from "react";

import {
  WORKTREE_BLOCKING_REASON_LABELS,
  type WorktreeScanResult,
  type WorktreeSizeState,
} from "../../../shared/worktrees";
import { formatWorktreeBytes } from "./formatWorktreeBytes";
import {
  buildSunburstHierarchy,
  describeArcPath,
  layoutSunburst,
  nodeColor,
  type SunburstArc,
  type SunburstNode,
} from "./sunburstGeometry";

export type WorktreeSelection = {
  commonDirectory: string;
  /** null = the repository itself is selected, not one of its worktrees. */
  worktreePath: string | null;
};

const VIEW_SIZE = 320;
const RADIUS = 148;
const CENTER_RADIUS = 54;
const CENTER = { x: VIEW_SIZE / 2, y: VIEW_SIZE / 2 };
const OTHER_SUFFIX = "/__other__";

type FoundNode = {
  node: SunburstNode;
  parent: SunburstNode | null;
  /** Ancestors from the hierarchy root down to (excluding) the node. */
  ancestors: SunburstNode[];
};

function findNode(root: SunburstNode, id: string): FoundNode | null {
  const walk = (node: SunburstNode, ancestors: SunburstNode[]): FoundNode | null => {
    if (node.id === id) return { node, parent: ancestors.at(-1) ?? null, ancestors };
    for (const child of node.children) {
      const found = walk(child, [...ancestors, node]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, []);
}

function percentOf(node: SunburstNode, parent: SunburstNode | null): string | null {
  if (parent === null || parent.bytes <= 0) return null;
  const ratio = node.bytes / parent.bytes;
  const rounded = Math.round(ratio * 100);
  return rounded === 0 && node.bytes > 0 ? "<1%" : `${rounded}%`;
}

function worktreeSafetyLabel(node: SunburstNode): string | null {
  const worktree = node.worktree;
  if (worktree === undefined) return null;
  if (worktree.cleanupCandidate) return "Cleanup candidate";
  return worktree.blockingReasons
    .map((reason) => WORKTREE_BLOCKING_REASON_LABELS[reason])
    .join(" · ");
}

function worktreeBranchLabel(node: SunburstNode): string | null {
  const worktree = node.worktree;
  if (worktree === undefined) return null;
  if (worktree.bare) return "Bare";
  if (worktree.branch !== null) return `Branch: ${worktree.branch}`;
  return worktree.detached ? "Detached HEAD" : "No branch";
}

function sectorAriaLabel(node: SunburstNode, parent: SunburstNode | null): string {
  const share = percentOf(node, parent);
  return `${node.name}, estimated ~${formatWorktreeBytes(node.bytes)}${
    share === null ? "" : `, ${share} of ${parent!.name}`
  }`;
}

export function WorktreeSunburst({
  scan,
  sizes,
  sizeProgress,
  drillPath,
  onDrillChange,
  onSelectionChange,
}: {
  scan: WorktreeScanResult | null;
  sizes: ReadonlyMap<string, WorktreeSizeState>;
  sizeProgress: { completed: number; total: number } | null;
  /** Node id (path) the chart is drilled into; null = the hierarchy root. */
  drillPath: string | null;
  onDrillChange: (path: string | null) => void;
  onSelectionChange: (selection: WorktreeSelection) => void;
}) {
  const [includeMainWorktrees, setIncludeMainWorktrees] = useState(true);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const hierarchy = useMemo(
    () => (scan === null ? null : buildSunburstHierarchy(scan, sizes, { includeMainWorktrees })),
    [scan, sizes, includeMainWorktrees],
  );

  const resolvedDrill = useMemo(() => {
    if (hierarchy === null) return null;
    const found = drillPath === null ? null : findNode(hierarchy, drillPath);
    if (found === null) {
      return { node: hierarchy, parent: null as SunburstNode | null, ancestors: [] };
    }
    return found;
  }, [hierarchy, drillPath]);

  const arcs = useMemo(() => {
    if (resolvedDrill === null || resolvedDrill.node.bytes <= 0) return [];
    return layoutSunburst(resolvedDrill.node, { radius: RADIUS, centerRadius: CENTER_RADIUS });
  }, [resolvedDrill]);

  // Parent lookup for every node in the hierarchy (Other nodes resolve by
  // stripping their synthetic suffix; aggregation never changes parent bytes).
  const parentMap = useMemo(() => {
    const map = new Map<string, SunburstNode>();
    if (hierarchy === null) return map;
    const walk = (node: SunburstNode) => {
      for (const child of node.children) {
        map.set(child.id, node);
        walk(child);
      }
    };
    walk(hierarchy);
    return map;
  }, [hierarchy]);

  const parentOf = (node: SunburstNode): SunburstNode | null =>
    node.kind === "other"
      ? (parentMap.get(node.id.slice(0, -OTHER_SUFFIX.length)) ?? null)
      : (parentMap.get(node.id) ?? null);

  const drillNode = resolvedDrill?.node ?? null;
  const breadcrumbs: SunburstNode[] =
    hierarchy === null || resolvedDrill === null
      ? []
      : [...resolvedDrill.ancestors, resolvedDrill.node];

  // Details region: hovered/focused sector, falling back to the drill root.
  const detailsNode = useMemo(() => {
    if (hierarchy === null || drillNode === null) return null;
    if (activeNodeId === null) return drillNode;
    if (activeNodeId.endsWith(OTHER_SUFFIX)) {
      return arcs.find((arc) => arc.node.id === activeNodeId)?.node ?? drillNode;
    }
    return findNode(hierarchy, activeNodeId)?.node ?? drillNode;
  }, [hierarchy, drillNode, activeNodeId, arcs]);

  const drillUp = () => {
    const parent = breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2] : null;
    if (parent === null || parent.id === "root") onDrillChange(null);
    else onDrillChange(parent.id);
  };

  const activateSector = (node: SunburstNode) => {
    // Other folds pruned/overflow entries and has no drillable subtree.
    if (node.kind === "other") return;
    if (node.kind === "repository") {
      onSelectionChange({ commonDirectory: node.commonDirectory ?? node.id, worktreePath: null });
    } else if (node.kind === "worktree") {
      onSelectionChange({ commonDirectory: node.commonDirectory ?? "", worktreePath: node.id });
    }
    onDrillChange(node.id);
  };

  const handleChartKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      drillUp();
    }
  };

  const measuring =
    sizeProgress !== null && sizeProgress.completed < sizeProgress.total ? sizeProgress : null;

  let chartMessage: string | null = null;
  if (scan === null) {
    chartMessage = "Scan worktrees to see storage usage.";
  } else if (hierarchy === null) {
    const measured = [...sizes.values()];
    chartMessage =
      measured.length > 0 && measured.every((size) => size.failed)
        ? "All size measurements failed."
        : "No storage measurements yet.";
  } else if (drillNode !== null && drillNode.bytes === 0) {
    chartMessage = "No measurable content.";
  }

  const summaryLabel =
    hierarchy === null || hierarchy.bytes <= 0
      ? "Storage chart: no measurements"
      : `Storage chart: total ~${formatWorktreeBytes(hierarchy.bytes)} across ${
          hierarchy.children.length === 1
            ? "1 repository"
            : `${hierarchy.children.length} repositories`
        }; ${hierarchy.children
          .map(
            (repo) =>
              `${repo.name} ~${formatWorktreeBytes(repo.bytes)} (${percentOf(repo, hierarchy) ?? "0%"})`,
          )
          .join(", ")}`;

  const detailsParent = detailsNode === null ? null : parentOf(detailsNode);
  const detailsShare = detailsNode === null ? null : percentOf(detailsNode, detailsParent);

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleChartKeyDown}>
      {breadcrumbs.length > 0 ? (
        <nav aria-label="Storage drill-down" className="flex flex-wrap items-center gap-1">
          {breadcrumbs.map((node, index) => (
            <span key={node.id} className="flex items-center gap-1">
              {index > 0 ? <span className="text-app-11 text-subtle">/</span> : null}
              <button
                type="button"
                onClick={() => onDrillChange(node.id === "root" ? null : node.id)}
                aria-current={index === breadcrumbs.length - 1 ? "true" : undefined}
                className={`rounded px-1 py-0.5 text-app-11 transition-colors hover:bg-surface-hover ${
                  index === breadcrumbs.length - 1 ? "text-fg" : "text-subtle hover:text-fg"
                }`}
              >
                {node.id === "root" ? "All storage" : node.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      {chartMessage !== null ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-surface px-4 text-center text-app-12 text-subtle">
          {chartMessage}
        </div>
      ) : (
        <div className="relative mx-auto w-full max-w-[320px]">
          <svg
            viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
            role="img"
            aria-label={summaryLabel}
            className="block h-auto w-full"
          >
            {arcs.map((arc) => (
              <SectorPath
                key={arc.node.id}
                arc={arc}
                parent={parentOf(arc.node) ?? drillNode}
                onActivate={activateSector}
                onShow={setActiveNodeId}
                onHide={() => setActiveNodeId(null)}
              />
            ))}
          </svg>
          <button
            type="button"
            data-testid="sunburst-center"
            onClick={drillUp}
            disabled={breadcrumbs.length <= 1}
            aria-label={
              breadcrumbs.length <= 1
                ? undefined
                : `Up one level to ${breadcrumbs[breadcrumbs.length - 2]?.id === "root" ? "All storage" : breadcrumbs[breadcrumbs.length - 2]?.name}`
            }
            className="absolute top-1/2 left-1/2 flex h-[104px] w-[104px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-center transition-colors hover:bg-surface-hover disabled:hover:bg-transparent"
          >
            <span className="max-w-full truncate text-app-12 font-medium text-fg">
              {drillNode?.id === "root" ? "All storage" : drillNode?.name}
            </span>
            <span className="text-app-11 text-subtle">
              ~{formatWorktreeBytes(drillNode?.bytes ?? 0)}
            </span>
          </button>
        </div>
      )}

      {measuring !== null ? (
        <p className="text-app-11 text-subtle">
          Measuring sizes {measuring.completed}/{measuring.total}…
        </p>
      ) : null}
      {drillNode?.incomplete ? (
        <p className="text-app-11 text-subtle">
          Some entries were unreadable; sizes are a lower bound.
        </p>
      ) : null}

      {detailsNode !== null ? (
        <div
          data-testid="sunburst-details"
          className="rounded-lg border border-border bg-surface px-3 py-2.5"
        >
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-app-12 font-medium text-fg">
              {detailsNode.id === "root" ? "All storage" : detailsNode.name}
            </span>
            <span className="shrink-0 text-app-11 tabular-nums text-subtle">
              ~{formatWorktreeBytes(detailsNode.bytes)}
              {detailsShare === null ? "" : ` · ${detailsShare}`}
            </span>
          </div>
          {detailsNode.path !== null ? (
            <div
              className="mt-0.5 truncate font-mono text-app-11 text-subtle"
              title={detailsNode.path}
            >
              {detailsNode.path}
            </div>
          ) : null}
          {worktreeBranchLabel(detailsNode) !== null ||
          worktreeSafetyLabel(detailsNode) !== null ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-app-11">
              {worktreeBranchLabel(detailsNode) !== null ? (
                <span className="text-subtle">{worktreeBranchLabel(detailsNode)}</span>
              ) : null}
              {worktreeSafetyLabel(detailsNode) !== null ? (
                <span
                  className={
                    detailsNode.worktree?.cleanupCandidate ? "text-success" : "text-warning"
                  }
                >
                  {worktreeSafetyLabel(detailsNode)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-app-12 text-muted">
          <input
            type="checkbox"
            checked={includeMainWorktrees}
            onChange={(event) => setIncludeMainWorktrees(event.target.checked)}
          />
          Include main worktrees
        </label>
        {hierarchy !== null && hierarchy.children.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {hierarchy.children.map((repository) => (
              <li key={repository.id} className="flex min-w-0 items-center gap-1.5 text-app-11">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: nodeColor(repository) }}
                />
                <span className="min-w-0 truncate text-muted">{repository.name}</span>
                <span className="shrink-0 tabular-nums text-subtle">
                  ~{formatWorktreeBytes(repository.bytes)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function SectorPath({
  arc,
  parent,
  onActivate,
  onShow,
  onHide,
}: {
  arc: SunburstArc;
  parent: SunburstNode | null;
  onActivate: (node: SunburstNode) => void;
  onShow: (nodeId: string) => void;
  onHide: () => void;
}) {
  const node = arc.node;
  // Other sectors render for visual completeness but are not focusable or
  // drillable: they aggregate pruned content and have no real subtree.
  if (node.kind === "other") {
    return (
      <path
        d={describeArcPath(arc, CENTER)}
        fill={arc.color}
        stroke="currentColor"
        strokeWidth={1}
        className="text-bg"
        aria-hidden="true"
      />
    );
  }
  return (
    <path
      d={describeArcPath(arc, CENTER)}
      fill={arc.color}
      stroke="currentColor"
      strokeWidth={1}
      className="text-bg cursor-pointer transition-opacity hover:opacity-80 focus:opacity-80 focus:outline-none"
      role="button"
      tabIndex={0}
      aria-label={sectorAriaLabel(node, parent)}
      onClick={() => onActivate(node)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(node);
        }
      }}
      onMouseEnter={() => onShow(node.id)}
      onMouseLeave={onHide}
      onFocus={() => onShow(node.id)}
      onBlur={onHide}
    />
  );
}
