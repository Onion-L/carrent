import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FolderGit2, FolderX, GitBranch, Lock, RefreshCw, Trash2 } from "lucide-react";

import {
  WORKTREE_BLOCKING_REASON_LABELS,
  type WorktreeNotGitEntry,
  type WorktreePruneRequest,
  type WorktreePruneResult,
  type WorktreeRecord,
  type WorktreeRemoveRequest,
  type WorktreeRemoveResult,
  type WorktreeRepositoryEntry,
  type WorktreeScanResult,
  type WorktreeSizeEvent,
  type WorktreeSizeStartResult,
  type WorktreeSizeState,
  type WorktreeSizeTarget,
  type WorktreeUnavailableEntry,
} from "../../../shared/worktrees";
import { ConfirmDialog } from "../ConfirmDialog";
import { SETTINGS_TABS } from "../../lib/settingsTabs";

const WORKTREES_TAB_LABEL =
  SETTINGS_TABS.find((tab) => tab.id === "worktrees")?.label ?? "Worktrees";

const PRELOAD_RESTART_MESSAGE =
  "Worktree support is not loaded in the current window. Restart Carrent and try again.";

export type WorktreeSettingsApi = {
  worktrees?: () => Promise<WorktreeScanResult>;
  worktreesPrune?: (request: WorktreePruneRequest) => Promise<WorktreePruneResult>;
  worktreesRemove?: (request: WorktreeRemoveRequest) => Promise<WorktreeRemoveResult>;
  worktreeSizesStart?: (targets: WorktreeSizeTarget[]) => Promise<WorktreeSizeStartResult>;

  worktreeSizesCancel?: (generation: number) => Promise<void>;
  onWorktreeSizeEvent?: (listener: (event: WorktreeSizeEvent) => void) => VoidFunction;
};

export function formatWorktreeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const valueText = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  const trimmed = valueText.endsWith(".0") ? valueText.slice(0, -2) : valueText;
  return `${trimmed} ${units[unitIndex]}`;
}

function measuredBytesOf(record: WorktreeRecord, sizes: Map<string, WorktreeSizeState>): number {
  const size = sizes.get(record.path);
  if (size === undefined || size.failed) return -1;
  return size.bytes;
}

export function compareWorktreeRecords(
  a: WorktreeRecord,
  b: WorktreeRecord,
  sizes: Map<string, WorktreeSizeState>,
): number {
  if (a.cleanupCandidate !== b.cleanupCandidate) return a.cleanupCandidate ? -1 : 1;
  const bytesA = measuredBytesOf(a, sizes);
  const bytesB = measuredBytesOf(b, sizes);
  if (bytesA !== bytesB) return bytesB - bytesA;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

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

function WorktreeRow({
  worktree,
  size,
  onRemoveRequest,
}: {
  worktree: WorktreeRecord;
  size?: WorktreeSizeState;
  onRemoveRequest?: () => void;
}) {
  const reasonText = worktree.blockingReasons
    .map((reason) => WORKTREE_BLOCKING_REASON_LABELS[reason])
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
          <StateBadge tone="warning">
            Live Run: {worktree.liveRunProjectNames.join(", ")}
          </StateBadge>
        ) : null}
        {worktree.runningTerminalProjectNames.length > 0 ? (
          <StateBadge tone="warning">
            Terminal: {worktree.runningTerminalProjectNames.join(", ")}
          </StateBadge>
        ) : null}
        {worktree.bare || worktree.missing || worktree.prunable ? null : size === undefined ? (
          <StateBadge>Calculating size…</StateBadge>
        ) : size.failed ? (
          <StateBadge tone="warning">Size unavailable</StateBadge>
        ) : (
          <StateBadge tone={size.incomplete ? "warning" : "subtle"}>
            {formatWorktreeBytes(size.bytes)}
            {size.incomplete ? " · incomplete" : ""}
          </StateBadge>
        )}
        {worktree.cleanupCandidate && onRemoveRequest !== undefined ? (
          <button
            type="button"
            onClick={onRemoveRequest}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-app-12 text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        ) : null}
      </div>
    </li>
  );
}
function prunableWorktrees(entry: WorktreeRepositoryEntry): WorktreeRecord[] {
  return entry.worktrees.filter((worktree) => worktree.prunable);
}

function RepositoryGroupView({
  entry,
  pruning,
  pruneError,
  onPruneRequest,
  sizes,
  removeMessage,
  onRemoveRequest,
}: {
  entry: WorktreeRepositoryEntry;
  pruning: boolean;
  pruneError: string | null;
  onPruneRequest: (entry: WorktreeRepositoryEntry) => void;
  sizes: Map<string, WorktreeSizeState>;
  removeMessage: { message: string; tone: "danger" | "success" } | null;
  onRemoveRequest: (worktree: WorktreeRecord) => void;
}) {
  const prunable = prunableWorktrees(entry);
  const sortedWorktrees = [...entry.worktrees].sort((a, b) => compareWorktreeRecords(a, b, sizes));

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
        {sortedWorktrees.map((worktree) => (
          <WorktreeRow
            key={worktree.path}
            worktree={worktree}
            size={sizes.get(worktree.path)}
            onRemoveRequest={
              worktree.cleanupCandidate ? () => onRemoveRequest(worktree) : undefined
            }
          />
        ))}
      </ul>
      {removeMessage !== null ? (
        <div className="border-t border-border px-4 py-2.5">
          <p
            className={`text-app-11 ${
              removeMessage.tone === "success" ? "text-success" : "text-danger"
            }`}
          >
            {removeMessage.message}
          </p>
        </div>
      ) : null}
      {prunable.length > 0 ? (
        <div className="border-t border-border px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-app-11 font-medium text-subtle">
              {prunable.length === 1
                ? "1 stale Git record"
                : `${prunable.length} stale Git records`}
            </span>
            <button
              type="button"
              onClick={() => onPruneRequest(entry)}
              disabled={pruning}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Prune records
            </button>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {prunable.map((worktree) => (
              <li
                key={worktree.path}
                className="flex min-w-0 items-baseline gap-2"
                title={worktree.prunableReason ?? undefined}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-app-11 text-subtle">
                  {worktree.path}
                </span>
                <span className="shrink-0 text-app-11 text-subtle">
                  {worktree.prunableReason ?? "stale record"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-app-11 text-subtle">
            Pruning removes Git administration records only. Existing worktree directories are never
            deleted, and this normally releases negligible disk space.
          </p>
          {pruneError !== null ? (
            <p className="mt-1 text-app-11 text-danger">{pruneError}</p>
          ) : null}
        </div>
      ) : null}
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

function RemoveWorktreeDialog({
  repository,
  worktree,
  size,
  deleteBranch,
  removing,
  onDeleteBranchChange,
  onCancel,
  onConfirm,
}: {
  repository: WorktreeRepositoryEntry;
  worktree: WorktreeRecord;
  size?: WorktreeSizeState;
  deleteBranch: boolean;
  removing: boolean;
  onDeleteBranchChange: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const sizeLine =
    size === undefined || size.failed
      ? ""
      : `\nEstimated size: ~${formatWorktreeBytes(size.bytes)}${
          size.incomplete ? " (incomplete, at least this much)" : ""
        } (logical directory size)`;
  const offerBranchDeletion = worktree.branchLocal && worktree.branch !== null;
  const branch = offerBranchDeletion
    ? worktree.branch
    : worktree.detached
      ? "Detached HEAD"
      : "None";

  return (
    <ConfirmDialog
      title="Remove linked worktree?"
      message={`Repository: ${repository.projects.join(", ")}
Branch: ${branch}
Path: ${worktree.path}${sizeLine}

The entire worktree directory — including ignored and hidden files such as node_modules, build
output, and local caches — will be permanently deleted.
Carrent cannot reliably detect external terminals, editors, coding agents, or other processes.
Check that nothing else is using this worktree before removing it.`}
      confirmLabel="Remove worktree"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {offerBranchDeletion ? (
        <label className="mt-3 flex items-start gap-2 text-app-12 text-muted">
          <input
            type="checkbox"
            checked={deleteBranch}
            onChange={(event) => onDeleteBranchChange(event.target.checked)}
            disabled={removing}
            className="mt-0.5"
          />
          <span>
            Also delete local branch <span className="font-mono">{worktree.branch}</span>. Git keeps
            the branch if it is not fully merged.
          </span>
        </label>
      ) : null}
    </ConfirmDialog>
  );
}

export function WorktreesPanelView({ api }: { api: WorktreeSettingsApi }) {
  const [scan, setScan] = useState<WorktreeScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pruneTarget, setPruneTarget] = useState<WorktreeRepositoryEntry | null>(null);
  const [pruning, setPruning] = useState(false);
  const [pruneError, setPruneError] = useState<{
    commonDirectory: string;
    message: string;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    repository: WorktreeRepositoryEntry;
    worktree: WorktreeRecord;
  } | null>(null);
  const [removeBranch, setRemoveBranch] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeMessage, setRemoveMessage] = useState<{
    commonDirectory: string;
    message: string;
    tone: "danger" | "success";
  } | null>(null);
  const [worktreeSizes, setWorktreeSizes] = useState<Map<string, WorktreeSizeState>>(
    () => new Map(),
  );
  const sizeGenerationRef = useRef<number | null>(null);
  const [sizeProgress, setSizeProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );

  const startSizeScan = useCallback(
    (result: WorktreeScanResult) => {
      const start = api.worktreeSizesStart;
      const cancel = api.worktreeSizesCancel;
      if (sizeGenerationRef.current !== null && cancel !== undefined) {
        void cancel(sizeGenerationRef.current);
      }
      if (start === undefined) return;
      const targets: WorktreeSizeTarget[] = [];
      for (const entry of result.entries) {
        if (entry.kind !== "repository") continue;
        for (const worktree of entry.worktrees) {
          if (worktree.bare || worktree.missing || worktree.prunable) continue;
          targets.push({ commonDirectory: entry.commonDirectory, worktreePath: worktree.path });
        }
      }
      if (targets.length === 0) {
        sizeGenerationRef.current = null;
        setWorktreeSizes(new Map());
        setSizeProgress(null);
        return;
      }
      void start(targets)
        .then((started) => {
          sizeGenerationRef.current = started.generation;
          setWorktreeSizes(new Map());
          setSizeProgress({ completed: 0, total: targets.length });
        })
        .catch(() => {
          sizeGenerationRef.current = null;
          setWorktreeSizes(new Map());
          setSizeProgress(null);
        });
    },
    [api],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await readWorktreeScan(api);
    setScan(result.scan);
    setError(result.error);
    setLoading(false);
    if (result.scan !== null) startSizeScan(result.scan);
  }, [api, startSizeScan]);

  const confirmPrune = useCallback(async () => {
    if (pruneTarget === null || pruning) return;
    setPruning(true);
    try {
      if (api.worktreesPrune === undefined) {
        throw new Error(PRELOAD_RESTART_MESSAGE);
      }
      const result = await api.worktreesPrune({ commonDirectory: pruneTarget.commonDirectory });
      setScan((current) =>
        current === null
          ? current
          : {
              ...current,
              scannedAt: result.scannedAt,
              entries: current.entries.map((entry) =>
                entry.kind === "repository" &&
                entry.commonDirectory === result.repository.commonDirectory
                  ? result.repository
                  : entry,
              ),
            },
      );
      setPruneError(null);
      setPruneTarget(null);
    } catch (pruneFailure) {
      setPruneError({
        commonDirectory: pruneTarget.commonDirectory,
        message: pruneFailure instanceof Error ? pruneFailure.message : String(pruneFailure),
      });
      setPruneTarget(null);
    } finally {
      setPruning(false);
    }
  }, [api, pruneTarget, pruning]);

  const confirmRemove = useCallback(async () => {
    if (removeTarget === null || removing) return;
    setRemoving(true);
    const target = removeTarget;
    try {
      if (api.worktreesRemove === undefined) {
        throw new Error(PRELOAD_RESTART_MESSAGE);
      }
      const result = await api.worktreesRemove({
        commonDirectory: target.repository.commonDirectory,
        worktreePath: target.worktree.path,
        deleteBranch: removeBranch,
      });
      setScan((current) =>
        current === null
          ? current
          : {
              ...current,
              scannedAt: result.scannedAt,
              entries: current.entries.map((entry) =>
                entry.kind === "repository" &&
                entry.commonDirectory === result.repository.commonDirectory
                  ? result.repository
                  : entry,
              ),
            },
      );
      setWorktreeSizes((current) => {
        const next = new Map(current);
        next.delete(target.worktree.path);
        return next;
      });
      if (result.status === "removed-branch-retained") {
        const branch = target.worktree.branch;
        setRemoveMessage({
          commonDirectory: target.repository.commonDirectory,
          tone: "success",
          message: `Worktree removed, but Git kept branch "${branch ?? "unknown"}". ${
            result.branchRetainedReason ?? ""
          }`.trim(),
        });
      } else {
        setRemoveMessage(null);
      }
      setRemoveTarget(null);
      setRemoveBranch(false);
    } catch (removeFailure) {
      setRemoveMessage({
        commonDirectory: target.repository.commonDirectory,
        tone: "danger",
        message: removeFailure instanceof Error ? removeFailure.message : String(removeFailure),
      });
      setRemoveTarget(null);
      setRemoveBranch(false);
    } finally {
      setRemoving(false);
    }
  }, [api, removeTarget, removeBranch, removing]);

  useEffect(() => {
    if (api.onWorktreeSizeEvent === undefined) return;
    const unsubscribe = api.onWorktreeSizeEvent((event) => {
      if (event.generation !== sizeGenerationRef.current) return;
      setWorktreeSizes((current) => {
        const next = new Map(current);
        next.set(event.worktreePath, event.result);
        return next;
      });
      setSizeProgress({ completed: event.completed, total: event.total });
    });
    return () => {
      unsubscribe();
      if (sizeGenerationRef.current !== null && api.worktreeSizesCancel !== undefined) {
        void api.worktreeSizesCancel(sizeGenerationRef.current);
      }
    };
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  let repositoryCount = 0;
  let linkedWorktreeCount = 0;
  let removableCount = 0;
  let releasableBytes = 0;
  for (const entry of scan?.entries ?? []) {
    if (entry.kind !== "repository") continue;
    repositoryCount += 1;
    for (const worktree of entry.worktrees) {
      if (worktree.kind !== "linked") continue;
      linkedWorktreeCount += 1;
      if (!worktree.cleanupCandidate) continue;
      removableCount += 1;
      const size = worktreeSizes.get(worktree.path);
      if (size !== undefined && !size.failed && !size.incomplete) {
        releasableBytes += size.bytes;
      }
    }
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
            : ` · ${repositoryCount} ${repositoryCount === 1 ? "repository" : "repositories"} · ${linkedWorktreeCount} linked · ${removableCount} removable · ~${formatWorktreeBytes(releasableBytes)} estimated releasable`}
          {sizeProgress !== null && sizeProgress.completed < sizeProgress.total
            ? ` · measuring sizes ${sizeProgress.completed}/${sizeProgress.total}`
            : ""}
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

  const prunableCount = pruneTarget === null ? 0 : prunableWorktrees(pruneTarget).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {scan.entries.map((entry) =>
            entry.kind === "repository" ? (
              <RepositoryGroupView
                key={entry.commonDirectory}
                entry={entry}
                pruning={pruning}
                pruneError={
                  pruneError?.commonDirectory === entry.commonDirectory ? pruneError.message : null
                }
                onPruneRequest={setPruneTarget}
                sizes={worktreeSizes}
                removeMessage={
                  removeMessage?.commonDirectory === entry.commonDirectory
                    ? { message: removeMessage.message, tone: removeMessage.tone }
                    : null
                }
                onRemoveRequest={(worktree) => {
                  setRemoveMessage(null);
                  setRemoveBranch(false);
                  setRemoveTarget({ repository: entry, worktree });
                }}
              />
            ) : (
              <ProjectEntryView key={entry.projectId} entry={entry} />
            ),
          )}
          <p className="px-1 pb-2 text-app-11 text-subtle">
            Carrent only accounts for the Runs and Terminal Tabs it manages. It cannot reliably
            detect external terminals, editors, coding agents, or other processes that may be using
            a worktree.
          </p>
        </div>
      </div>
      {pruneTarget !== null ? (
        <ConfirmDialog
          title="Prune stale worktree records?"
          message={`Remove ${prunableCount} stale Git administration ${
            prunableCount === 1 ? "record" : "records"
          } for ${pruneTarget.projects.join(", ")}?\n${prunableWorktrees(pruneTarget)
            .map((worktree) => worktree.path)
            .join("\n")}\nPruning removes Git administration records only, does not delete
          an existing worktree directory, and normally releases negligible disk space.`}
          confirmLabel="Prune"
          onCancel={() => setPruneTarget(null)}
          onConfirm={() => void confirmPrune()}
        />
      ) : null}
      {removeTarget !== null ? (
        <RemoveWorktreeDialog
          repository={removeTarget.repository}
          worktree={removeTarget.worktree}
          size={worktreeSizes.get(removeTarget.worktree.path)}
          deleteBranch={removeBranch}
          removing={removing}
          onDeleteBranchChange={setRemoveBranch}
          onCancel={() => {
            setRemoveTarget(null);
            setRemoveBranch(false);
          }}
          onConfirm={() => void confirmRemove()}
        />
      ) : null}
    </div>
  );
}
