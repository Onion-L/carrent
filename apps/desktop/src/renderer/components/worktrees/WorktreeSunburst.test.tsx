import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
  WorktreeRecord,
  WorktreeScanResult,
  WorktreeSizeNode,
  WorktreeSizeState,
} from "../../../shared/worktrees";
import { WorktreeSunburst, type WorktreeSelection } from "./WorktreeSunburst";

function makeWorktree(overrides: Partial<WorktreeRecord>): WorktreeRecord {
  return {
    path: "/code/alpha",
    kind: "linked",
    bare: false,
    branch: "feat",
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

function sizeNode(
  path: string,
  bytes: number,
  children: WorktreeSizeNode[] = [],
): WorktreeSizeNode {
  return { name: path.split("/").at(-1) ?? path, path, bytes, kind: "directory", children };
}

function makeChartScan(): WorktreeScanResult {
  return {
    entries: [
      {
        kind: "repository",
        commonDirectory: "/code/alpha/.git",
        projects: ["alpha"],
        worktrees: [
          makeWorktree({
            path: "/code/alpha",
            kind: "main",
            branch: "main",
            blockingReasons: ["main"],
            cleanupCandidate: false,
          }),
          makeWorktree({ path: "/code/alpha/feat-wt", branch: "feat" }),
        ],
      },
      {
        kind: "repository",
        commonDirectory: "/code/beta/.git",
        projects: ["beta"],
        worktrees: [
          makeWorktree({
            path: "/code/beta",
            kind: "main",
            branch: "main",
            blockingReasons: ["main"],
            cleanupCandidate: false,
          }),
        ],
      },
    ],
    scannedAt: "2026-08-13T00:00:00.000Z",
  };
}

function makeChartSizes(): Map<string, WorktreeSizeState> {
  return new Map([
    [
      "/code/alpha",
      {
        bytes: 800,
        incomplete: false,
        failed: false,
        root: sizeNode("/code/alpha", 800, [
          sizeNode("/code/alpha/src", 500),
          sizeNode("/code/alpha/dist", 300),
        ]),
      },
    ],
    [
      "/code/alpha/feat-wt",
      {
        bytes: 400,
        incomplete: false,
        failed: false,
        root: sizeNode("/code/alpha/feat-wt", 400, [
          sizeNode("/code/alpha/feat-wt/node_modules", 300),
        ]),
      },
    ],
    [
      "/code/beta",
      {
        bytes: 200,
        incomplete: false,
        failed: false,
        root: sizeNode("/code/beta", 200, [sizeNode("/code/beta/src", 200)]),
      },
    ],
  ]);
}

type RecordedCalls = {
  drills: Array<string | null>;
  selections: WorktreeSelection[];
};

function Harness({
  scan,
  sizes,
  sizeProgress = null,
  calls,
}: {
  scan: WorktreeScanResult | null;
  sizes: Map<string, WorktreeSizeState>;
  sizeProgress?: { completed: number; total: number } | null;
  calls: RecordedCalls;
}) {
  const [drillPath, setDrillPath] = useState<string | null>(null);
  return createElement(WorktreeSunburst, {
    scan,
    sizes,
    sizeProgress,
    drillPath,
    onDrillChange: (path: string | null) => {
      calls.drills.push(path);
      setDrillPath(path);
    },
    onSelectionChange: (selection: WorktreeSelection) => {
      calls.selections.push(selection);
    },
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderChart(props: {
  scan?: WorktreeScanResult | null;
  sizes?: Map<string, WorktreeSizeState>;
  sizeProgress?: { completed: number; total: number } | null;
  calls?: RecordedCalls;
}) {
  const calls = props.calls ?? { drills: [], selections: [] };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(Harness, {
        scan: props.scan === undefined ? makeChartScan() : props.scan,
        sizes: props.sizes ?? makeChartSizes(),
        sizeProgress: props.sizeProgress ?? null,
        calls,
      }),
    );
  });
  return { c: container, calls };
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function keyDown(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

async function hover(element: Element) {
  // React implements mouseenter via delegated mouseover.
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

function sectors(c: HTMLElement): Element[] {
  return [...c.querySelectorAll('path[role="button"]')];
}

function sector(c: HTMLElement, labelPart: string): Element {
  const found = sectors(c).find((path) => path.getAttribute("aria-label")?.includes(labelPart));
  if (!found) throw new Error(`sector not found: ${labelPart}`);
  return found;
}

function centerButton(c: HTMLElement): HTMLButtonElement {
  const button = c.querySelector(".relative button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("center button not found");
  return button;
}

function svgLabel(c: HTMLElement): string {
  const svg = c.querySelector('svg[role="img"]');
  if (!svg) throw new Error("chart svg not found");
  return svg.getAttribute("aria-label") ?? "";
}

describe("WorktreeSunburst", () => {
  it("renders sectors with a textual summary of totals and top-level shares", async () => {
    const { c } = await renderChart({});

    const label = svgLabel(c);
    expect(label).toContain("Storage chart: total ~1.4 KB across 2 repositories");
    expect(label).toContain("alpha ~1.2 KB (86%)");
    expect(label).toContain("beta ~200 B (14%)");

    // Ring 0: 2 repositories; ring 1: 3 worktrees; ring 2: 4 directories.
    expect(sectors(c).length).toBe(9);
    for (const path of sectors(c)) {
      expect(path.getAttribute("tabindex")).toBe("0");
    }
    expect(sector(c, "feat").getAttribute("aria-label")).toBe(
      "feat, estimated ~400 B, 33% of alpha",
    );
  });

  it("drills into a repository sector on click and selects the repository", async () => {
    const { c, calls } = await renderChart({});

    await click(sector(c, "alpha,"));

    expect(calls.drills).toEqual(["/code/alpha/.git"]);
    expect(calls.selections).toEqual([{ commonDirectory: "/code/alpha/.git", worktreePath: null }]);
    expect(centerButton(c).textContent).toContain("alpha");
    expect(centerButton(c).textContent).toContain("~1.2 KB");
  });

  it("drills into a worktree sector and selects the worktree", async () => {
    const { c, calls } = await renderChart({});

    await click(sector(c, "feat,"));

    expect(calls.drills).toEqual(["/code/alpha/feat-wt"]);
    expect(calls.selections).toEqual([
      { commonDirectory: "/code/alpha/.git", worktreePath: "/code/alpha/feat-wt" },
    ]);
    expect(centerButton(c).textContent).toContain("feat");
  });

  it("drills with Enter and Space without selecting sub-worktree directories", async () => {
    const { c, calls } = await renderChart({});

    await keyDown(sector(c, "alpha,"), "Enter");
    expect(calls.drills).toEqual(["/code/alpha/.git"]);

    await keyDown(sector(c, "main"), " ");
    expect(calls.drills).toEqual(["/code/alpha/.git", "/code/alpha"]);
    // Worktree sectors select too.
    expect(calls.selections).toEqual([
      { commonDirectory: "/code/alpha/.git", worktreePath: null },
      { commonDirectory: "/code/alpha/.git", worktreePath: "/code/alpha" },
    ]);
    expect(centerButton(c).textContent).toContain("main");

    // Directory drills never touch the list selection.
    await keyDown(sector(c, "src"), "Enter");
    expect(calls.drills).toEqual(["/code/alpha/.git", "/code/alpha", "/code/alpha/src"]);
    expect(calls.selections).toHaveLength(2);
  });

  it("navigates back up via breadcrumbs and the center button", async () => {
    const { c, calls } = await renderChart({});

    await click(sector(c, "alpha,"));
    await click(sector(c, "main"));

    const crumbs = [...c.querySelectorAll('nav[aria-label="Storage drill-down"] button')];
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual(["All storage", "alpha", "main"]);

    await click(crumbs[1]!);
    expect(calls.drills.at(-1)).toBe("/code/alpha/.git");
    expect(centerButton(c).textContent).toContain("alpha");

    const up = centerButton(c);
    expect(up.getAttribute("aria-label")).toBe("Up one level to All storage");
    await click(up);
    expect(calls.drills.at(-1)).toBe(null);
    expect(centerButton(c).textContent).toContain("All storage");
    // At the root the center button is a no-op.
    expect(centerButton(c).disabled).toBe(true);
  });

  it("goes up one level on Escape and Backspace", async () => {
    const { c, calls } = await renderChart({});

    await click(sector(c, "alpha,"));
    await keyDown(sector(c, "feat,"), "Escape");
    expect(calls.drills.at(-1)).toBe(null);

    await click(sector(c, "beta,"));
    await keyDown(sector(c, "main"), "Backspace");
    expect(calls.drills.at(-1)).toBe(null);
  });

  it("shows the drill root in the details region until a sector is hovered", async () => {
    const { c } = await renderChart({});

    const details = c.querySelector('[data-testid="sunburst-details"]');
    expect(details).not.toBe(null);
    expect(details!.textContent).toContain("All storage");
    expect(details!.textContent).toContain("~1.4 KB");

    await hover(sector(c, "feat,"));
    expect(details!.textContent).toContain("feat");
    expect(details!.textContent).toContain("/code/alpha/feat-wt");
    expect(details!.textContent).toContain("~400 B");
    expect(details!.textContent).toContain("33%");
    expect(details!.textContent).toContain("Branch: feat");
    expect(details!.textContent).toContain("Cleanup candidate");
  });

  it("shows blocking reasons instead of the cleanup state for unsafe worktrees", async () => {
    const scan = makeChartScan();
    const alpha = scan.entries[0];
    if (alpha.kind !== "repository") throw new Error("expected repository");
    alpha.worktrees[1] = makeWorktree({
      path: "/code/alpha/feat-wt",
      branch: "feat",
      dirty: true,
      blockingReasons: ["dirty"],
      cleanupCandidate: false,
    });
    const { c } = await renderChart({ scan });

    await hover(sector(c, "feat,"));

    const details = c.querySelector('[data-testid="sunburst-details"]');
    expect(details!.textContent).toContain("Uncommitted changes");
    expect(details!.textContent).not.toContain("Cleanup candidate");
  });

  it("toggles main worktrees out of the chart data with the legend checkbox", async () => {
    const { c } = await renderChart({});
    expect(svgLabel(c)).toContain("2 repositories");
    expect(svgLabel(c)).toContain("~1.4 KB");

    const checkbox = c.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error("checkbox not found");
    expect(checkbox.checked).toBe(true);
    await click(checkbox);

    // Beta only has a main worktree, so it drops out entirely.
    expect(svgLabel(c)).toContain("Storage chart: total ~400 B across 1 repository");
    expect(sectors(c).some((path) => path.getAttribute("aria-label")?.includes("beta"))).toBe(
      false,
    );
  });

  it("renders Other sectors without making them focusable or drillable", async () => {
    const scan: WorktreeScanResult = {
      entries: [
        {
          kind: "repository",
          commonDirectory: "/code/mono/.git",
          projects: ["mono"],
          worktrees: [
            makeWorktree({
              path: "/code/mono",
              kind: "main",
              branch: "main",
              blockingReasons: ["main"],
              cleanupCandidate: false,
            }),
          ],
        },
      ],
      scannedAt: "2026-08-13T00:00:00.000Z",
    };
    const children = Array.from({ length: 14 }, (_, index) =>
      sizeNode(`/code/mono/pkg-${index}`, 10),
    );
    const sizes = new Map<string, WorktreeSizeState>([
      [
        "/code/mono",
        {
          bytes: 140,
          incomplete: false,
          failed: false,
          root: sizeNode("/code/mono", 140, children),
        },
      ],
    ]);
    const { c } = await renderChart({ scan, sizes });

    expect(c.querySelector('path[aria-hidden="true"]')).not.toBe(null);
    expect(sectors(c).some((path) => path.getAttribute("aria-label")?.includes("Other"))).toBe(
      false,
    );
  });

  it("notes in-flight measurement while rendering the sectors measured so far", async () => {
    const { c } = await renderChart({ sizeProgress: { completed: 1, total: 3 } });

    expect(c.textContent).toContain("Measuring sizes 1/3…");
    expect(sectors(c).length).toBeGreaterThan(0);
  });

  it("shows a muted message instead of fake sectors when nothing is measured", async () => {
    const { c } = await renderChart({ sizes: new Map() });

    expect(c.textContent).toContain("No storage measurements yet.");
    expect(sectors(c)).toHaveLength(0);
    expect(c.querySelector('svg[role="img"]')).toBe(null);
  });

  it("reports when every measurement failed", async () => {
    const sizes = new Map<string, WorktreeSizeState>([
      ["/code/alpha", { bytes: 0, incomplete: false, failed: true, root: null }],
      ["/code/alpha/feat-wt", { bytes: 0, incomplete: false, failed: true, root: null }],
    ]);
    const { c } = await renderChart({ sizes });

    expect(c.textContent).toContain("All size measurements failed.");
    expect(sectors(c)).toHaveLength(0);
  });

  it("reports when the drill root has no measurable content", async () => {
    const sizes = new Map<string, WorktreeSizeState>([
      [
        "/code/alpha",
        { bytes: 0, incomplete: false, failed: false, root: sizeNode("/code/alpha", 0) },
      ],
      [
        "/code/alpha/feat-wt",
        { bytes: 0, incomplete: false, failed: false, root: sizeNode("/code/alpha/feat-wt", 0) },
      ],
      [
        "/code/beta",
        { bytes: 0, incomplete: false, failed: false, root: sizeNode("/code/beta", 0) },
      ],
    ]);
    const { c } = await renderChart({ sizes });

    expect(c.textContent).toContain("No measurable content.");
    expect(sectors(c)).toHaveLength(0);
  });

  it("warns that incomplete traversals are a lower bound", async () => {
    const sizes = makeChartSizes();
    sizes.set("/code/alpha/feat-wt", {
      bytes: 400,
      incomplete: true,
      failed: false,
      root: sizeNode("/code/alpha/feat-wt", 400, [
        sizeNode("/code/alpha/feat-wt/node_modules", 300),
      ]),
    });
    const { c } = await renderChart({ sizes });

    expect(c.textContent).toContain("Some entries were unreadable; sizes are a lower bound.");
  });
});
