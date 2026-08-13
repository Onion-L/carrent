import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { WorktreeRecord, WorktreeScanResult } from "../../../shared/worktrees";
import { readWorktreeScan, WorktreesPanelView, type WorktreeSettingsApi } from "./WorktreesPanel";

function deferredScan() {
  let resolveScan!: (scan: WorktreeScanResult) => void;
  const promise = new Promise<WorktreeScanResult>((resolve) => {
    resolveScan = resolve;
  });
  return { promise, resolveScan };
}

function makeWorktree(overrides: Partial<WorktreeRecord>): WorktreeRecord {
  return {
    path: "/code/carrent",
    kind: "linked",
    bare: false,
    branch: "feat",
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

function makeScan(overrides: Partial<WorktreeScanResult> = {}): WorktreeScanResult {
  return {
    entries: [
      {
        kind: "repository",
        commonDirectory: "/code/carrent/.git",
        projects: ["carrent", "carrent-feature"],
        worktrees: [
          makeWorktree({
            path: "/code/carrent",
            kind: "main",
            branch: "main",
            blockingReasons: ["main"],
            cleanupCandidate: false,
          }),
          makeWorktree({ path: "/code/carrent/feat-wt", branch: "feat" }),
        ],
      },
    ],
    scannedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderPanel(api: WorktreeSettingsApi) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(WorktreesPanelView, { api }));
  });
  return container;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("readWorktreeScan", () => {
  it("returns a restart hint when the preload does not expose worktrees", async () => {
    const result = await readWorktreeScan({});
    expect(result.scan).toBe(null);
    expect(result.error).toContain("Restart Carrent");
  });

  it("returns the scan from the preload API when available", async () => {
    const scan = makeScan();
    const result = await readWorktreeScan({ worktrees: async () => scan });
    expect(result.error).toBe(null);
    expect(result.scan).toBe(scan);
  });

  it("returns the error message when the preload call rejects", async () => {
    const result = await readWorktreeScan({
      worktrees: async () => {
        throw new Error("scan failed");
      },
    });
    expect(result.scan).toBe(null);
    expect(result.error).toBe("scan failed");
  });
});

describe("WorktreesPanelView", () => {
  it("shows a loading state while the first scan is pending", async () => {
    const { promise, resolveScan } = deferredScan();
    const c = await renderPanel({ worktrees: () => promise });

    expect(c.querySelector('[role="status"][aria-label="Loading worktree scan"]')).not.toBe(null);

    await act(async () => {
      resolveScan(makeScan());
      await promise;
    });

    expect(c.textContent).toContain("carrent");
  });

  it("shows the error state and retries on demand", async () => {
    let calls = 0;
    const c = await renderPanel({
      worktrees: async () => {
        calls += 1;
        if (calls === 1) throw new Error("git exploded");
        return makeScan();
      },
    });

    expect(c.textContent).toContain("Could not load worktrees");
    expect(c.textContent).toContain("git exploded");

    const retry = [...c.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Retry",
    );
    if (!retry) throw new Error("retry button not found");
    await click(retry);

    expect(c.textContent).toContain("carrent");
    expect(calls).toBe(2);
  });

  it("shows the empty state when no Projects are available", async () => {
    const c = await renderPanel({
      worktrees: async () => ({ entries: [], scannedAt: "2026-08-13T00:00:00.000Z" }),
    });

    expect(c.textContent).toContain("No Projects to scan");
  });

  it("groups a repository by its Project names and lists main and linked worktrees", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    expect(c.textContent).toContain("carrent, carrent-feature");
    expect(c.textContent).toContain("/code/carrent/.git");
    expect(c.textContent).toContain("Main");
    expect(c.textContent).toContain("Linked");
    expect(c.textContent).toContain("/code/carrent/feat-wt");
    expect(c.textContent).toContain("feat");
    expect(c.textContent).toContain("main");
  });

  it("marks the main worktree non-removable with its reason", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    expect(c.textContent).toContain("Main worktree");
  });

  it("marks a clean linked worktree as a cleanup candidate", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    expect(c.textContent).toContain("Cleanup candidate");
  });

  it("shows all blocking reasons together for a dirty locked detached worktree", async () => {
    const c = await renderPanel({
      worktrees: async () =>
        makeScan({
          entries: [
            {
              kind: "repository",
              commonDirectory: "/code/carrent/.git",
              projects: ["carrent"],
              worktrees: [
                makeWorktree({
                  path: "/code/carrent/blocked-wt",
                  branch: null,
                  detached: true,
                  locked: true,
                  lockReason: "release in progress",
                  dirty: true,
                  hasUntracked: true,
                  hasSubmodules: true,
                  projectNames: ["carrent-blocked"],
                  blockingReasons: ["dirty", "detached", "locked", "submodules", "carrent-project"],
                  cleanupCandidate: false,
                }),
              ],
            },
          ],
        }),
    });

    expect(c.textContent).toContain("Uncommitted changes");
    expect(c.textContent).toContain("Detached HEAD");
    expect(c.textContent).toContain("Locked by Git");
    expect(c.textContent).toContain("Contains submodules");
    expect(c.textContent).toContain("Referenced by a Carrent Project");
    expect(c.textContent).toContain("Not removable");
    expect(c.textContent).not.toContain("Cleanup candidate");
  });

  it("shows untracked, detached, locked, prunable and submodule state badges", async () => {
    const c = await renderPanel({
      worktrees: async () =>
        makeScan({
          entries: [
            {
              kind: "repository",
              commonDirectory: "/code/carrent/.git",
              projects: ["carrent"],
              worktrees: [
                makeWorktree({
                  path: "/code/carrent/states-wt",
                  branch: null,
                  detached: true,
                  dirty: true,
                  hasUntracked: true,
                  locked: true,
                  lockReason: "keep until demo",
                  prunable: true,
                  prunableReason: "gitdir file points to non-existent location",
                  missing: true,
                  hasSubmodules: true,
                  projectNames: ["carrent-states"],
                  blockingReasons: ["missing", "prunable"],
                  cleanupCandidate: false,
                }),
              ],
            },
          ],
        }),
    });

    expect(c.textContent).toContain("Untracked files");
    expect(c.textContent).toContain("Detached");
    expect(c.textContent).toContain("Locked");
    expect(c.textContent).toContain("keep until demo");
    expect(c.textContent).toContain("Prunable");
    expect(c.textContent).toContain("gitdir file points to non-existent location");
    expect(c.textContent).toContain("Directory missing");
    expect(c.textContent).toContain("Submodules");
    expect(c.textContent).toContain("carrent-states");
  });

  it("labels a bare main worktree as Bare, not Detached", async () => {
    const c = await renderPanel({
      worktrees: async () =>
        makeScan({
          entries: [
            {
              kind: "repository",
              commonDirectory: "/code/bare.git",
              projects: ["bare"],
              worktrees: [
                makeWorktree({
                  path: "/code/bare.git",
                  kind: "main",
                  bare: true,
                  branch: null,
                  blockingReasons: ["main"],
                  cleanupCandidate: false,
                }),
              ],
            },
          ],
        }),
    });

    expect(c.textContent).toContain("Bare");
    expect(c.textContent).not.toContain("Detached");
  });

  it("keeps non-Git and unavailable Project Working Directories visible", async () => {
    const c = await renderPanel({
      worktrees: async () => ({
        entries: [
          {
            kind: "not-git",
            projectId: "p1",
            projectName: "notes",
            workingDirectory: "/code/notes",
          },
          {
            kind: "unavailable",
            projectId: "p2",
            projectName: "gone",
            workingDirectory: "/code/gone",
          },
        ],
        scannedAt: "2026-08-13T00:00:00.000Z",
      }),
    });

    expect(c.textContent).toContain("notes");
    expect(c.textContent).toContain("Not a Git repository");
    expect(c.textContent).toContain("/code/notes");
    expect(c.textContent).toContain("gone");
    expect(c.textContent).toContain("Directory unavailable");
    expect(c.textContent).toContain("/code/gone");
  });

  it("keeps a repository with only a main worktree visible", async () => {
    const c = await renderPanel({
      worktrees: async () =>
        makeScan({
          entries: [
            {
              kind: "repository",
              commonDirectory: "/code/solo/.git",
              projects: ["solo"],
              worktrees: [
                makeWorktree({
                  path: "/code/solo",
                  kind: "main",
                  branch: "main",
                  blockingReasons: ["main"],
                  cleanupCandidate: false,
                }),
              ],
            },
          ],
        }),
    });

    expect(c.textContent).toContain("solo");
    expect(c.textContent).toContain("1 worktree");
  });

  it("refreshes the scan from the toolbar button", async () => {
    let calls = 0;
    const c = await renderPanel({
      worktrees: async () => {
        calls += 1;
        return makeScan();
      },
    });

    const refresh = c.querySelector('button[aria-label="Refresh worktree scan"]');
    if (!refresh) throw new Error("refresh button not found");
    await click(refresh);

    expect(calls).toBe(2);
  });
  it("shows live Run and Terminal Tab blockers together with Git and Project blockers", async () => {
    const c = await renderPanel({
      worktrees: async () =>
        makeScan({
          entries: [
            {
              kind: "repository",
              commonDirectory: "/code/carrent/.git",
              projects: ["carrent"],
              worktrees: [
                makeWorktree({
                  path: "/code/carrent/feat-wt",
                  dirty: true,
                  projectNames: ["carrent-feature"],
                  liveRunProjectNames: ["carrent"],
                  runningTerminalProjectNames: ["carrent-feature"],
                  blockingReasons: ["dirty", "carrent-project", "live-run", "terminal-tab"],
                  cleanupCandidate: false,
                }),
              ],
            },
          ],
        }),
    });

    expect(c.textContent).toContain("Uncommitted changes");
    expect(c.textContent).toContain("Referenced by a Carrent Project");
    expect(c.textContent).toContain("Live Run in repository");
    expect(c.textContent).toContain("Running Terminal Tab");
    expect(c.textContent).toContain("Live Run: carrent");
    expect(c.textContent).toContain("Terminal: carrent-feature");
    expect(c.textContent).toContain("Not removable");
    expect(c.textContent).not.toContain("Cleanup candidate");
  });

  it("explains that external processes cannot be reliably detected", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    expect(c.textContent).toContain(
      "cannot reliably detect external terminals, editors, coding agents",
    );
  });
});
