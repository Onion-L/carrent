import { useCallback, useEffect, useState } from "react";
import { Check, FolderGit2, FolderX, GitBranch, Lock, RefreshCw } from "lucide-react";

import type {
  WorktreeBlockingReason,
  WorktreeNotGitEntry,
  WorktreeRecord,
  WorktreeRepositoryEntry,
  WorktreeScanResult,
  WorktreeUnavailableEntry,
} from "../../../shared/worktrees";
import { SETTINGS_TABS } from "../../lib/settingsTabs";

const WORKTREES_TAB_LABEL =
  SETTINGS_TABS.find((tab) => tab.id === "worktrees")?.label ?? "Worktrees";

const PRELOAD_RESTART_MESSAGE =
  "Worktree support is not loaded in the current window. Restart Carrent and try again.";

const BLOCKING_REASON_LABELS: Record<WorktreeBlockingReason, string> = {
  main: "Main worktree",
  dirty: "Uncommitted changes",
  detached: "Detached HEAD",
  locked: "Locked by Git",
  submodules: "Contains submodules",
  "carrent-project": "Referenced by a Carrent Project",
  missing: "Directory missing",
  prunable: "Prunable Git record",
  "live-run": "Live Run in repository",
  "terminal-tab": "Running Terminal Tab",
};

export type WorktreeSettingsApi = {
  worktrees?: () => Promise<WorktreeScanResult>;
};

export async function readWorktreeScan(api: WorktreeSettingsApi): Promise<{
  scan: WorktreeScanResult | null;
  error: string | null;
}> {
  if (api.worktrees === undefined) {
    return { scan: null, error: PRELOAD_RESTART_MESSAGE };
  }
  try {
    return { scan: await api.worktrees(), error: null };
  } catch (error) {
    return { scan: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function WorktreesPanel() {
  return <WorktreesPanelView api={window.carrent.settings} />;
}

function StateBadge({
  children,
  title,
  tone = "subtle",
}: {
  children: React.ReactNode;
  title?: string;
  tone?: "subtle" | "warning";
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full bg-surface px-1.5 py-px text-app-10 ${
        tone === "warning" ? "text-warning" : "text-subtle"
      }`}
    >
      {children}
    </span>
  );
}

function WorktreeRow({ worktree }: { worktree: WorktreeRecord }) {
  const reasonText = worktree.blockingReasons
    .map((reason) => BLOCKING_REASON_LABELS[reason])
    .join(" · ");

  return (
    <li className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-full bg-surface px-1.5 py-px text-app-10 text-subtle">
          {worktree.kind === "main" ? "Main" : "Linked"}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-app-12 text-fg"
          title={worktree.path}
        >
          {worktree.path}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-app-11 text-subtle">
          {worktree.bare ? (
            "Bare"
          ) : worktree.detached ? (
            "Detached"
          ) : (
            <>
              <GitBranch className="h-3 w-3" />
              {worktree.branch}
            </>
          )}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {worktree.cleanupCandidate ? (
          <span className="flex shrink-0 items-center gap-1 text-app-11 text-success">
            <Check className="h-3.5 w-3.5" />
            Cleanup candidate
          </span>
        ) : (
          <span
            className="flex shrink-0 items-center gap-1 text-app-11 text-warning"
            title={reasonText}
          >
            <Lock className="h-3.5 w-3.5" />
            Not removable{reasonText === "" ? "" : ` — ${reasonText}`}
          </span>
        )}

        {worktree.dirty ? <StateBadge>Dirty</StateBadge> : null}
        {worktree.hasUntracked ? <StateBadge>Untracked files</StateBadge> : null}
        {worktree.locked ? (
          <StateBadge tone="warning" title={worktree.lockReason ?? undefined}>
            Locked{worktree.lockReason === null ? "" : `: ${worktree.lockReason}`}
          </StateBadge>
        ) : null}
        {worktree.prunable ? (
          <StateBadge tone="warning" title={worktree.prunableReason ?? undefined}>
            Prunable{worktree.prunableReason === null ? "" : `: ${worktree.prunableReason}`}
          </StateBadge>
        ) : null}
        {worktree.hasSubmodules ? <StateBadge>Submodules</StateBadge> : null}
        {worktree.projectNames.length > 0 ? (
          <StateBadge>Project: {worktree.projectNames.join(", ")}</StateBadge>
        ) : null}
        {worktree.liveRunProjectNames.length > 0 ? (
          <StateBadge tone="warning">Live Run: {worktree.liveRunProjectNames.join(", ")}</StateBadge>
        ) : null}
        {worktree.runningTerminalProjectNames.length > 0 ? (
          <StateBadge tone="warning">
            Terminal: {worktree.runningTerminalProjectNames.join(", ")}
          </StateBadge>
        ) : null}
      </div>
    </li>
  );
}

function RepositoryGroupView({ entry }: { entry: WorktreeRepositoryEntry }) {
  return (
    <section
      aria-label={`Repository ${entry.projects.join(", ")}`}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <header className="border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <FolderGit2 className="h-3.5 w-3.5 shrink-0 self-center text-subtle" />
          <span className="min-w-0 truncate text-app-13 font-medium text-fg">
            {entry.projects.join(", ")}
          </span>
          <span className="shrink-0 text-app-11 text-subtle">
            {entry.worktrees.length === 1 ? "1 worktree" : `${entry.worktrees.length} worktrees`}
          </span>
        </div>
        <div
          className="mt-0.5 truncate font-mono text-app-11 text-subtle"
          title={entry.commonDirectory}
        >
          {entry.commonDirectory}
        </div>
      </header>
      <ul>
        {entry.worktrees.map((worktree) => (
          <WorktreeRow key={worktree.path} worktree={worktree} />
        ))}
      </ul>
    </section>
  );
}

function ProjectEntryView({ entry }: { entry: WorktreeNotGitEntry | WorktreeUnavailableEntry }) {
  const unavailable = entry.kind === "unavailable";
  return (
    <section
      aria-label={
        unavailable ? "Unavailable Project Working Directory" : "Non-Git Project Working Directory"
      }
      className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      {unavailable ? (
        <FolderX className="h-4 w-4 shrink-0 text-warning" />
      ) : (
        <FolderGit2 className="h-4 w-4 shrink-0 text-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-app-13 font-medium text-fg">
            {entry.projectName}
          </span>
          <span className={`shrink-0 text-app-11 ${unavailable ? "text-warning" : "text-subtle"}`}>
            {unavailable ? "Directory unavailable" : "Not a Git repository"}
          </span>
        </div>
        <div className="truncate font-mono text-app-11 text-subtle" title={entry.workingDirectory}>
          {entry.workingDirectory}
        </div>
      </div>
    </section>
  );
}

function WorktreesSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading worktree scan"
      className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {[0, 1].map((group) => (
          <div key={group} className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <div className="h-3.5 w-48 rounded bg-surface-hover" />
              <div className="mt-1.5 h-3 w-64 rounded bg-surface" />
            </div>
            <div className="flex flex-col gap-2 px-4 py-3">
              <div className="h-3.5 w-72 rounded bg-surface" />
              <div className="h-3 w-40 rounded bg-surface" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorktreesPanelView({ api }: { api: WorktreeSettingsApi }) {
  const [scan, setScan] = useState<WorktreeScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await readWorktreeScan(api);
    setScan(result.scan);
    setError(result.error);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  let repositoryCount = 0;
  let linkedWorktreeCount = 0;
  for (const entry of scan?.entries ?? []) {
    if (entry.kind !== "repository") continue;
    repositoryCount += 1;
    linkedWorktreeCount += entry.worktrees.filter((worktree) => worktree.kind === "linked").length;
  }

  const refreshButton = (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={loading}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
      title="Refresh worktree scan"
      aria-label="Refresh worktree scan"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
    </button>
  );

  const header = (
    <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="flex shrink-0 items-center gap-2 self-center text-app-13 font-semibold text-fg">
          <GitBranch className="h-4 w-4 text-subtle" />
          {WORKTREES_TAB_LABEL}
        </h1>
        <p className="min-w-0 truncate text-app-12 text-subtle">
          Git worktrees reachable from your Projects
          {scan === null
            ? ""
            : ` · ${repositoryCount} ${repositoryCount === 1 ? "repository" : "repositories"} · ${linkedWorktreeCount} linked`}
        </p>
      </div>
      {refreshButton}
    </div>
  );

  if (loading && scan === null && error === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <WorktreesSkeleton />
      </div>
    );
  }

  if (error !== null && scan === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface px-4 py-6">
            <div className="text-app-13 text-fg">Could not load worktrees</div>
            <div className="mt-1 text-app-12 text-subtle">{error}</div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-4 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (scan === null || scan.entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface px-4 py-6">
            <div className="text-app-13 text-fg">No Projects to scan</div>
            <div className="mt-1 text-app-12 text-subtle">
              Worktree scanning covers the Project Working Directories you add to Carrent. Add a
              Project to see its Git worktrees here.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {scan.entries.map((entry) =>
            entry.kind === "repository" ? (
              <RepositoryGroupView key={entry.commonDirectory} entry={entry} />
            ) : (
              <ProjectEntryView key={entry.projectId} entry={entry} />
            ),
          )}
          <p className="px-1 pb-2 text-app-11 text-subtle">
            Carrent only accounts for the Runs and Terminal Tabs it manages. It cannot reliably
            detect external terminals, editors, coding agents, or other processes that may be
            using a worktree.
          </p>
        </div>
      </div>
    </div>
  );
}
