import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type {
  WorktreeRecord,
  WorktreeScanResult,
  WorktreeSizeEvent,
  WorktreeSizeState,
} from "../../../shared/worktrees";
import { formatWorktreeBytes } from "./formatWorktreeBytes";
import {
  compareWorktreeRecords,
  readWorktreeScan,
  WorktreesPanelView,
  type WorktreeSettingsApi,
} from "./WorktreesPanel";

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
    expect(c.querySelector('[data-common-directory="/code/carrent/.git"]')).not.toBe(null);
    expect(c.textContent).toContain("Main");
    expect(c.textContent).toContain("feat-wt");
    expect(c.textContent).toContain("feat");
    expect(c.textContent).toContain("main");
  });

  it("tags the main worktree as Main without a removal state", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    expect(c.textContent).toContain("Main");
    expect(c.textContent).not.toContain("Not removable");
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

describe("WorktreesPanelView pruning", () => {
  function prunableScan() {
    return {
      entries: [
        {
          kind: "repository" as const,
          commonDirectory: "/code/carrent/.git",
          projects: ["carrent"],
          worktrees: [
            makeWorktree({
              path: "/code/carrent",
              kind: "main",
              branch: "main",
              blockingReasons: ["main"],
              cleanupCandidate: false,
            }),
            makeWorktree({
              path: "/code/carrent/gone-wt",
              branch: "old",
              prunable: true,
              prunableReason: "gitdir file points to non-existent location",
              missing: true,
              blockingReasons: ["missing", "prunable"],
              cleanupCandidate: false,
            }),
          ],
        },
        {
          kind: "repository" as const,
          commonDirectory: "/code/other/.git",
          projects: ["other"],
          worktrees: [
            makeWorktree({
              path: "/code/other",
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

  it("previews stale records with paths and Git reasons per repository", async () => {
    const c = await renderPanel({ worktrees: async () => prunableScan() });

    expect(c.textContent).toContain("1 stale Git record");
    expect(c.textContent).toContain("/code/carrent/gone-wt");
    expect(c.textContent).toContain("gitdir file points to non-existent location");
    expect(c.textContent).toContain("Prune records");
    expect(c.textContent).toContain("Existing worktree directories are never deleted");
  });

  it("hides the prune section when a repository has no stale records", async () => {
    const c = await renderPanel({
      worktrees: async () => ({
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
        scannedAt: "2026-08-13T00:00:00.000Z",
      }),
    });

    expect(c.textContent).not.toContain("stale Git record");
    expect(c.textContent).not.toContain("Prune records");
  });

  it("asks for confirmation before pruning and cancels without an api call", async () => {
    let pruneCalls = 0;
    const c = await renderPanel({
      worktrees: async () => prunableScan(),
      worktreesPrune: async () => {
        pruneCalls += 1;
        throw new Error("should not be called");
      },
    });

    const pruneButton = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Prune records",
    );
    if (!pruneButton) throw new Error("prune button not found");
    await click(pruneButton);

    const dialog = c.querySelector('[role="dialog"]');
    expect(dialog).not.toBe(null);
    expect(dialog!.textContent).toContain("Prune stale worktree records?");
    expect(dialog!.textContent).toContain("Remove 1 stale Git administration record");
    expect(dialog!.textContent).toContain("does not delete");
    expect(dialog!.textContent).toContain("negligible disk space");

    const cancel = [...dialog!.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    if (!cancel) throw new Error("cancel button not found");
    await click(cancel);

    expect(pruneCalls).toBe(0);
    expect(c.querySelector('[role="dialog"]')).toBe(null);
  });

  it("prunes the named repository and rescans only that repository on success", async () => {
    const prunedEntries = prunableScan().entries;
    prunedEntries[0] = {
      kind: "repository",
      commonDirectory: "/code/carrent/.git",
      projects: ["carrent"],
      worktrees: [
        makeWorktree({
          path: "/code/carrent",
          kind: "main",
          branch: "main",
          blockingReasons: ["main"],
          cleanupCandidate: false,
        }),
      ],
    };
    const requests: Array<{ commonDirectory: string }> = [];
    const c = await renderPanel({
      worktrees: async () => prunableScan(),
      worktreesPrune: async (request) => {
        requests.push(request);
        return { repository: prunedEntries[0], scannedAt: "2026-08-13T00:01:00.000Z" };
      },
    });

    const pruneButton = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Prune records",
    );
    if (!pruneButton) throw new Error("prune button not found");
    await click(pruneButton);
    const confirm = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Prune",
    );
    if (!confirm) throw new Error("confirm button not found");
    await click(confirm);

    expect(requests).toEqual([{ commonDirectory: "/code/carrent/.git" }]);
    expect(c.textContent).not.toContain("/code/carrent/gone-wt");
    expect(c.textContent).not.toContain("Prune records");
    expect(c.querySelector('[data-common-directory="/code/other/.git"]')).not.toBe(null);
    expect(c.querySelector('[role="dialog"]')).toBe(null);
  });

  it("keeps records visible and shows the failure when pruning fails", async () => {
    const c = await renderPanel({
      worktrees: async () => prunableScan(),
      worktreesPrune: async () => {
        throw new Error("git exploded");
      },
    });

    const pruneButton = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Prune records",
    );
    if (!pruneButton) throw new Error("prune button not found");
    await click(pruneButton);
    const confirm = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Prune",
    );
    if (!confirm) throw new Error("confirm button not found");
    await click(confirm);

    expect(c.textContent).toContain("git exploded");
    expect(c.textContent).toContain("/code/carrent/gone-wt");
    expect(c.textContent).toContain("1 stale Git record");
    expect(c.querySelector('[role="dialog"]')).toBe(null);
  });
});
describe("worktree size presentation", () => {
  it("formats bytes into readable units", () => {
    expect(formatWorktreeBytes(0)).toBe("0 B");
    expect(formatWorktreeBytes(1023)).toBe("1023 B");
    expect(formatWorktreeBytes(1024)).toBe("1 KB");
    expect(formatWorktreeBytes(2048)).toBe("2 KB");
    expect(formatWorktreeBytes(3 * 1024 * 1024)).toBe("3 MB");
    expect(formatWorktreeBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("sorts removable worktrees first, then by size, with a path fallback", () => {
    const sizes = new Map<string, WorktreeSizeState>();
    const removableSmall = makeWorktree({ path: "/r/small", cleanupCandidate: true });
    const removableLarge = makeWorktree({ path: "/r/large", cleanupCandidate: true });
    const blocked = makeWorktree({
      path: "/r/blocked",
      cleanupCandidate: false,
      blockingReasons: ["dirty"],
    });
    const main = makeWorktree({
      path: "/r",
      kind: "main",
      cleanupCandidate: false,
      blockingReasons: ["main"],
    });

    sizes.set("/r/small", { bytes: 100, incomplete: false, failed: false, root: null });
    sizes.set("/r/large", { bytes: 900, incomplete: false, failed: false, root: null });

    expect(
      [removableLarge, removableSmall].sort((a, b) => compareWorktreeRecords(a, b, sizes)),
    ).toEqual([removableLarge, removableSmall]);
    // Missing sizes fall back to the path order.
    expect([blocked, main].sort((a, b) => compareWorktreeRecords(a, b, sizes))).toEqual([
      main,
      blocked,
    ]);
    // A failed measurement sorts like a missing one.
    sizes.set("/r/small", { bytes: 0, incomplete: false, failed: true, root: null });
    expect(
      [removableSmall, removableLarge].sort((a, b) => compareWorktreeRecords(a, b, sizes)),
    ).toEqual([removableLarge, removableSmall]);
  });

  function sizeApi(scan: WorktreeScanResult) {
    const listeners = new Set<(event: WorktreeSizeEvent) => void>();
    const starts: unknown[] = [];
    const cancels: number[] = [];
    let nextGeneration = 0;
    const api: WorktreeSettingsApi = {
      worktrees: async () => scan,
      worktreeSizesStart: async (targets) => {
        starts.push(targets);
        nextGeneration += 1;
        return { generation: nextGeneration };
      },
      worktreeSizesCancel: async (generation) => {
        cancels.push(generation);
      },
      onWorktreeSizeEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return {
      api,
      starts,
      cancels,
      emit: (event: WorktreeSizeEvent) => {
        for (const listener of listeners) listener(event);
      },
    };
  }

  it("renders the Git inventory before sizes arrive", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    expect(c.textContent).toContain("carrent, carrent-feature");
    expect(c.textContent).toContain("Calculating size…");
    expect(c.textContent).toContain("Calculating sizes…");
  });

  it("shows per-worktree sizes and the summary as measurements complete", async () => {
    const fake = sizeApi(makeScan());
    const c = await renderPanel(fake.api);
    expect(fake.starts).toHaveLength(1);

    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent",
        result: { bytes: 1024 * 1024, incomplete: false, failed: false, root: null },
        completed: 1,
        total: 2,
      });
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        result: { bytes: 3 * 1024 * 1024, incomplete: false, failed: false, root: null },
        completed: 2,
        total: 2,
      });
    });

    expect(c.textContent).toContain("3 MB");
    expect(c.textContent).not.toContain("Calculating size…");
    expect(c.textContent).toContain("1 repository");
    expect(c.textContent).toContain("1 linked");
    expect(c.textContent).toContain("1 removable");
    expect(c.textContent).toContain("releasable — 1 cleanup candidate");
  });

  it("shows overall measurement progress while scans are in flight", async () => {
    const fake = sizeApi(
      makeScan({
        entries: [
          {
            kind: "repository",
            commonDirectory: "/code/carrent/.git",
            projects: ["carrent"],
            worktrees: [
              makeWorktree({
                path: "/code/carrent",
                kind: "main",
                branch: "main",
                blockingReasons: ["main"],
                cleanupCandidate: false,
              }),
              makeWorktree({ path: "/code/carrent/feat-wt", branch: "feat" }),
              makeWorktree({ path: "/code/carrent/feat2-wt", branch: "feat-2" }),
            ],
          },
        ],
      }),
    );
    const c = await renderPanel(fake.api);

    // Only the two linked worktrees are measured automatically; main is on demand.
    expect(c.textContent).toContain("measuring 0/2");

    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        result: { bytes: 1, incomplete: false, failed: false, root: null },
        completed: 1,
        total: 2,
      });
    });
    expect(c.textContent).toContain("measuring 1/2");

    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat2-wt",
        result: { bytes: 2, incomplete: false, failed: false, root: null },
        completed: 2,
        total: 2,
      });
    });
    expect(c.textContent).not.toContain("measuring");
  });

  it("never measures main worktrees automatically", async () => {
    const fake = sizeApi(makeScan());
    await renderPanel(fake.api);

    expect(fake.starts).toHaveLength(1);
    expect(fake.starts[0]).toEqual([
      { commonDirectory: "/code/carrent/.git", worktreePath: "/code/carrent/feat-wt" },
    ]);
  });

  it("measures a main worktree on demand via Calculate", async () => {
    const fake = sizeApi(makeScan());
    const c = await renderPanel(fake.api);

    // The hero is honest about the incomplete total while main is unmeasured.
    expect(c.textContent).toContain("Linked worktree storage, estimated");

    const calculate = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Calculate",
    );
    if (!calculate) throw new Error("Calculate button not found");
    await click(calculate);

    expect(fake.starts[1]).toEqual([
      { commonDirectory: "/code/carrent/.git", worktreePath: "/code/carrent" },
    ]);

    await act(async () => {
      fake.emit({
        generation: 2,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent",
        result: { bytes: 90 * 1024 * 1024 * 1024, incomplete: false, failed: false, root: null },
        completed: 1,
        total: 1,
      });
    });

    expect(c.textContent).toContain("90 GB");
    expect(c.textContent).toContain("Worktree storage, estimated");
    expect(c.textContent).not.toContain("Linked worktree storage");
    // Once measured, the row offers a forced re-measurement instead.
    expect(
      [...c.querySelectorAll("button")].some((button) => button.textContent === "Recalculate"),
    ).toBe(true);
  });

  it("excludes main, blocked, incomplete, failed, and calculating worktrees from releasable space", async () => {
    const scan = makeScan({
      entries: [
        {
          kind: "repository",
          commonDirectory: "/code/carrent/.git",
          projects: ["carrent"],
          worktrees: [
            makeWorktree({
              path: "/code/carrent",
              kind: "main",
              branch: "main",
              blockingReasons: ["main"],
              cleanupCandidate: false,
            }),
            makeWorktree({
              path: "/code/carrent/blocked-wt",
              branch: "blocked",
              dirty: true,
              blockingReasons: ["dirty"],
              cleanupCandidate: false,
            }),
            makeWorktree({
              path: "/code/carrent/complete-wt",
              branch: "complete",
            }),
            makeWorktree({
              path: "/code/carrent/incomplete-wt",
              branch: "incomplete",
            }),
            makeWorktree({ path: "/code/carrent/failed-wt", branch: "failed" }),
            makeWorktree({ path: "/code/carrent/calculating-wt", branch: "calculating" }),
          ],
        },
      ],
    });
    const fake = sizeApi(scan);
    const c = await renderPanel(fake.api);

    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/complete-wt",
        result: { bytes: 2048, incomplete: false, failed: false, root: null },
        completed: 1,
        total: 5,
      });
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/incomplete-wt",
        result: { bytes: 4096, incomplete: true, failed: false, root: null },
        completed: 2,
        total: 5,
      });
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/failed-wt",
        result: { bytes: 0, incomplete: false, failed: true, root: null },
        completed: 3,
        total: 5,
      });
    });

    // Only the complete, removable worktree contributes.
    expect(c.textContent).toContain("4 removable");
    expect(c.textContent).toContain("~2 KB");
    expect(c.textContent).toContain("Size unavailable");
    expect(c.textContent).toContain("incomplete");
  });

  it("drops events from a stale generation", async () => {
    let scanVersion = 0;
    const fake = sizeApi(makeScan());
    const c = await renderPanel({
      ...fake.api,
      worktrees: async () => {
        scanVersion += 1;
        return makeScan();
      },
    });

    // Refresh supersedes generation 1 with generation 2.
    const refresh = c.querySelector('button[aria-label="Refresh worktree scan"]');
    if (!refresh) throw new Error("refresh button not found");
    await click(refresh);
    expect(scanVersion).toBe(2);
    expect(fake.cancels).toEqual([1]);

    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        result: { bytes: 2048, incomplete: false, failed: false, root: null },
        completed: 1,
        total: 1,
      });
    });
    expect(c.textContent).toContain("Calculating size…");
    expect(c.textContent).not.toContain("2 KB");
  });

  it("cancels outstanding measurement when the tab unmounts", async () => {
    const fake = sizeApi(makeScan());
    const c = await renderPanel(fake.api);
    expect(fake.starts).toHaveLength(1);

    await act(async () => {
      root?.unmount();
    });
    c.remove();
    root = null;
    container = null;

    expect(fake.cancels).toEqual([1]);
  });
});

describe("WorktreesPanelView removal", () => {
  function removalScan(): WorktreeScanResult {
    return {
      entries: [
        {
          kind: "repository",
          commonDirectory: "/code/carrent/.git",
          projects: ["carrent"],
          worktrees: [
            makeWorktree({
              path: "/code/carrent",
              kind: "main",
              branch: "main",
              blockingReasons: ["main"],
              cleanupCandidate: false,
            }),
            makeWorktree({ path: "/code/carrent/feat-wt", branch: "feat" }),
            makeWorktree({
              path: "/code/carrent/dirty-wt",
              branch: "dirty",
              dirty: true,
              blockingReasons: ["dirty"],
              cleanupCandidate: false,
            }),
          ],
        },
        {
          kind: "repository",
          commonDirectory: "/code/other/.git",
          projects: ["other"],
          worktrees: [
            makeWorktree({
              path: "/code/other",
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

  function removalSizeApi(scan: WorktreeScanResult) {
    const listeners = new Set<(event: WorktreeSizeEvent) => void>();
    const api: WorktreeSettingsApi = {
      worktrees: async () => scan,
      worktreeSizesStart: async () => ({ generation: 1 }),
      worktreeSizesCancel: async () => {},
      onWorktreeSizeEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return {
      api,
      emit: (event: WorktreeSizeEvent) => {
        for (const listener of listeners) listener(event);
      },
    };
  }

  function removeButtonOf(c: HTMLDivElement): HTMLButtonElement {
    const button = [...c.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Remove",
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("Remove button not found");
    return button;
  }

  function confirmButtonOf(c: HTMLDivElement): HTMLButtonElement {
    const button = [...c.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Remove worktree",
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("confirm button not found");
    return button;
  }

  async function check(input: HTMLInputElement) {
    // happy-dom's click default action toggles the native checked state
    // before React processes the event, like a real browser.
    await act(async () => {
      input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("exposes removal only for cleanup candidates", async () => {
    const c = await renderPanel({ worktrees: async () => removalScan() });

    const removeButtons = [...c.querySelectorAll("button")].filter(
      (button) => button.textContent === "Remove",
    );
    expect(removeButtons).toHaveLength(1);
  });

  it("asks for confirmation with repository, branch, path, size, and deletion warnings", async () => {
    const fake = removalSizeApi(removalScan());
    const c = await renderPanel(fake.api);
    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        result: { bytes: 2 * 1024 * 1024, incomplete: false, failed: false, root: null },
        completed: 1,
        total: 1,
      });
    });

    await click(removeButtonOf(c));

    const dialog = c.querySelector('[role="dialog"]');
    expect(dialog).not.toBe(null);
    const text = dialog!.textContent ?? "";
    expect(text).toContain("Remove feat-wt?");
    expect(text).toContain("~2 MB");
    expect(text).toContain("permanently deleted");
    expect(text).toContain("Also delete branch");

    const checkbox = dialog!.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBe(null);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("cancels the confirmation without calling the removal api", async () => {
    let removeCalls = 0;
    const c = await renderPanel({
      worktrees: async () => removalScan(),
      worktreesRemove: async () => {
        removeCalls += 1;
        throw new Error("should not be called");
      },
    });

    await click(removeButtonOf(c));
    const dialog = c.querySelector('[role="dialog"]');
    expect(dialog).not.toBe(null);
    const cancel = [...dialog!.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    if (!cancel) throw new Error("cancel button not found");
    await click(cancel);

    expect(removeCalls).toBe(0);
    expect(c.querySelector('[role="dialog"]')).toBe(null);
  });

  it("omits the branch-deletion option for non-local branch identities", async () => {
    const scan = removalScan();
    const entry = scan.entries[0];
    if (entry.kind !== "repository") throw new Error("expected repository");
    entry.worktrees = [
      makeWorktree({
        path: "/code/carrent",
        kind: "main",
        branch: "main",
        blockingReasons: ["main"],
        cleanupCandidate: false,
      }),
      makeWorktree({
        path: "/code/carrent/feat-wt",
        branch: "refs/remotes/origin/feat",
        branchLocal: false,
      }),
    ];
    const c = await renderPanel({ worktrees: async () => scan });

    await click(removeButtonOf(c));

    const dialog = c.querySelector('[role="dialog"]');
    expect(dialog).not.toBe(null);
    expect(dialog!.querySelector('input[type="checkbox"]')).toBe(null);
    expect(dialog!.textContent).not.toContain("Also delete local branch");
  });

  it("defaults branch deletion to off and sends the opt-in when checked", async () => {
    const requests: Array<{
      commonDirectory: string;
      worktreePath: string;
      deleteBranch?: boolean;
    }> = [];
    const removedEntry = {
      kind: "repository" as const,
      commonDirectory: "/code/carrent/.git",
      projects: ["carrent"],
      worktrees: [
        makeWorktree({
          path: "/code/carrent",
          kind: "main",
          branch: "main",
          blockingReasons: ["main"],
          cleanupCandidate: false,
        }),
      ],
    };
    const c = await renderPanel({
      worktrees: async () => removalScan(),
      worktreesRemove: async (request) => {
        requests.push(request);
        return {
          status: "removed",
          repository: removedEntry,
          scannedAt: "2026-08-13T00:01:00.000Z",
        };
      },
    });

    await click(removeButtonOf(c));
    const dialog = c.querySelector('[role="dialog"]');
    const checkbox = dialog!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await check(checkbox);
    await click(confirmButtonOf(c));

    expect(requests).toEqual([
      {
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        deleteBranch: true,
      },
    ]);
    expect(c.textContent).not.toContain("/code/carrent/feat-wt");
    expect(c.querySelector('[role="dialog"]')).toBe(null);
  });

  it("sends the unchecked default and refreshes only the affected repository", async () => {
    const requests: Array<{
      commonDirectory: string;
      worktreePath: string;
      deleteBranch?: boolean;
    }> = [];
    const removedEntry = {
      kind: "repository" as const,
      commonDirectory: "/code/carrent/.git",
      projects: ["carrent"],
      worktrees: [
        makeWorktree({
          path: "/code/carrent",
          kind: "main",
          branch: "main",
          blockingReasons: ["main"],
          cleanupCandidate: false,
        }),
      ],
    };
    const fake = removalSizeApi(removalScan());
    const c = await renderPanel({
      ...fake.api,
      worktreesRemove: async (request) => {
        requests.push(request);
        return {
          status: "removed",
          repository: removedEntry,
          scannedAt: "2026-08-13T00:01:00.000Z",
        };
      },
    });
    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        result: { bytes: 2 * 1024 * 1024, incomplete: false, failed: false, root: null },
        completed: 1,
        total: 1,
      });
    });
    expect(c.textContent).toContain("~2 MB");

    await click(removeButtonOf(c));
    await click(confirmButtonOf(c));

    expect(requests).toEqual([
      {
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        deleteBranch: false,
      },
    ]);
    expect(c.textContent).not.toContain("/code/carrent/feat-wt");
    expect(c.querySelector('[data-common-directory="/code/other/.git"]')).not.toBe(null);
    expect(c.textContent).not.toContain("2 MB");
    expect(c.textContent).toContain("0 removable");
    expect(c.querySelector('[role="dialog"]')).toBe(null);
  });

  it("reports partial success when Git keeps the branch", async () => {
    const removedEntry = {
      kind: "repository" as const,
      commonDirectory: "/code/carrent/.git",
      projects: ["carrent"],
      worktrees: [
        makeWorktree({
          path: "/code/carrent",
          kind: "main",
          branch: "main",
          blockingReasons: ["main"],
          cleanupCandidate: false,
        }),
      ],
    };
    const c = await renderPanel({
      worktrees: async () => removalScan(),
      worktreesRemove: async () => ({
        status: "removed-branch-retained",
        repository: removedEntry,
        scannedAt: "2026-08-13T00:01:00.000Z",
        branchRetainedReason: "error: The branch 'feat' is not fully merged.",
      }),
    });

    await click(removeButtonOf(c));
    const dialog = c.querySelector('[role="dialog"]');
    const checkbox = dialog!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await check(checkbox);
    await click(confirmButtonOf(c));

    expect(c.textContent).toContain('Worktree removed, but Git kept branch "feat"');
    expect(c.textContent).toContain("not fully merged");
    expect(c.textContent).not.toContain("/code/carrent/feat-wt");
  });

  it("keeps the worktree listed and shows the failure when removal is refused", async () => {
    const c = await renderPanel({
      worktrees: async () => removalScan(),
      worktreesRemove: async () => {
        throw new Error("This worktree can no longer be removed safely: Uncommitted changes.");
      },
    });

    await click(removeButtonOf(c));
    await click(confirmButtonOf(c));

    expect(c.textContent).toContain("This worktree can no longer be removed safely");
    expect(c.textContent).toContain("feat-wt");
    expect(c.querySelector('[role="dialog"]')).toBe(null);
  });
});

describe("WorktreesPanelView hero and selection", () => {
  function sizeTree(path: string, bytes: number): WorktreeSizeState {
    return {
      bytes,
      incomplete: false,
      failed: false,
      root: {
        name: path.split("/").at(-1) ?? path,
        path,
        bytes,
        kind: "directory",
        children: [
          {
            name: "src",
            path: `${path}/src`,
            bytes: Math.floor(bytes / 2),
            kind: "directory",
            children: [],
          },
        ],
      },
    };
  }

  function syncSizeApi(scan: WorktreeScanResult) {
    const listeners = new Set<(event: WorktreeSizeEvent) => void>();
    const api: WorktreeSettingsApi = {
      worktrees: async () => scan,
      worktreeSizesStart: async () => ({ generation: 1 }),
      worktreeSizesCancel: async () => {},
      onWorktreeSizeEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return {
      api,
      emit: (event: WorktreeSizeEvent) => {
        for (const listener of listeners) listener(event);
      },
    };
  }

  async function emitSizes(fake: ReturnType<typeof syncSizeApi>) {
    await act(async () => {
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent",
        result: sizeTree("/code/carrent", 2048),
        completed: 1,
        total: 2,
      });
      fake.emit({
        generation: 1,
        commonDirectory: "/code/carrent/.git",
        worktreePath: "/code/carrent/feat-wt",
        result: sizeTree("/code/carrent/feat-wt", 1024),
        completed: 2,
        total: 2,
      });
    });
  }

  function listPane(c: HTMLDivElement): Element {
    const pane = c.querySelector('[data-testid="worktrees-list-pane"]');
    if (!pane) throw new Error("list pane not found");
    return pane;
  }

  function heroPane(c: HTMLDivElement): Element {
    const pane = c.querySelector('[data-testid="worktrees-hero-pane"]');
    if (!pane) throw new Error("hero pane not found");
    return pane;
  }

  it("renders the hero and list panes", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    expect(c.querySelector('[data-testid="worktrees-list-pane"]')).not.toBe(null);
    expect(c.querySelector('[data-testid="worktrees-hero-pane"]')).not.toBe(null);
    // The list renders the Git inventory even before any measurement exists.
    expect(listPane(c).textContent).toContain("feat-wt");
    expect(listPane(c).textContent).toContain(
      "cannot reliably detect external terminals, editors, coding agents",
    );
    // The hero waits for measurements instead of fabricating a total.
    expect(heroPane(c).textContent).toContain("Calculating sizes…");
  });

  it("shows the measured total and releasable space in the hero", async () => {
    const fake = syncSizeApi(makeScan());
    const c = await renderPanel(fake.api);
    await emitSizes(fake);

    const hero = heroPane(c).textContent ?? "";
    // 2048 + 1024 bytes measured across the repository.
    expect(hero).toContain("3");
    expect(hero).toContain("KB");
    // Only the cleanup candidate counts as releasable.
    expect(hero).toContain("~1 KB");
    expect(hero).toContain("1 cleanup candidate");
  });

  it("selecting a worktree row highlights it", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    const row = listPane(c).querySelector('[data-worktree-path="/code/carrent/feat-wt"]');
    if (!row) throw new Error("worktree row not found");
    await click(row);

    expect(row.getAttribute("aria-current")).toBe("true");
  });

  it("selecting a repository group header highlights it", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    const header = listPane(c).querySelector('[data-common-directory="/code/carrent/.git"]');
    if (!header) throw new Error("repository header not found");
    await click(header);

    expect(header.getAttribute("aria-current")).toBe("true");
  });

  it("does not change the selection when the Remove button is clicked", async () => {
    const c = await renderPanel({ worktrees: async () => makeScan() });

    const remove = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Remove",
    );
    if (!remove) throw new Error("Remove button not found");
    await click(remove);

    expect(c.querySelector('[role="dialog"]')).not.toBe(null);
    expect(listPane(c).querySelector('[aria-current="true"]')).toBe(null);

    const cancel = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    if (!cancel) throw new Error("cancel button not found");
    await click(cancel);
  });

  it("clears the selection when the selected worktree is removed", async () => {
    const removedEntry = {
      kind: "repository" as const,
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
      ],
    };
    const fake = syncSizeApi(makeScan());
    const c = await renderPanel({
      ...fake.api,
      worktreesRemove: async () => ({
        status: "removed",
        repository: removedEntry,
        scannedAt: "2026-08-13T00:01:00.000Z",
      }),
    });
    await emitSizes(fake);

    const row = listPane(c).querySelector('[data-worktree-path="/code/carrent/feat-wt"]');
    if (!row) throw new Error("worktree row not found");
    await click(row);
    expect(row.getAttribute("aria-current")).toBe("true");

    const remove = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Remove",
    );
    if (!remove) throw new Error("Remove button not found");
    await click(remove);
    const confirm = [...c.querySelectorAll("button")].find(
      (button) => button.textContent === "Remove worktree",
    );
    if (!confirm) throw new Error("confirm button not found");
    await click(confirm);

    expect(listPane(c).querySelector('[data-worktree-path="/code/carrent/feat-wt"]')).toBe(null);
    expect(listPane(c).querySelector('[aria-current="true"]')).toBe(null);
  });
});
