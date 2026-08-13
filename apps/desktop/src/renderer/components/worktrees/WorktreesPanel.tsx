import { useCallback, useEffect, useRef, useState } from "react";
import { FolderGit2, FolderX, GitBranch, RefreshCw, Trash2 } from "lucide-react";

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
  type WorktreeSizeStartOptions,
  type WorktreeSizeStartResult,
  type WorktreeSizeState,
  type WorktreeSizeTarget,
  type WorktreeUnavailableEntry,
} from "../../../shared/worktrees";
import { ConfirmDialog } from "../ConfirmDialog";
import { SETTINGS_TABS } from "../../lib/settingsTabs";
import { formatWorktreeBytes } from "./formatWorktreeBytes";
import { repositoryColor } from "./worktreeColors";

type WorktreeSelection = {
  commonDirectory: string;
  /** null = the repository itself is selected, not one of its worktrees. */
  worktreePath: string | null;
};

const WORKTREES_TAB_LABEL =
  SETTINGS_TABS.find((tab) => tab.id === "worktrees")?.label ?? "Worktrees";

const PRELOAD_RESTART_MESSAGE =
  "Worktree support is not loaded in the current window. Restart Carrent and try again.";

export type WorktreeSettingsApi = {
  worktrees?: () => Promise<WorktreeScanResult>;
  worktreesPrune?: (request: WorktreePruneRequest) => Promise<WorktreePruneResult>;
  worktreesRemove?: (request: WorktreeRemoveRequest) => Promise<WorktreeRemoveResult>;
  worktreeSizesStart?: (
    targets: WorktreeSizeTarget[],
    options?: WorktreeSizeStartOptions,
  ) => Promise<WorktreeSizeStartResult>;

  worktreeSizesCancel?: (generation: number) => Promise<void>;
  onWorktreeSizeEvent?: (listener: (event: WorktreeSizeEvent) => void) => VoidFunction;
};

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
      className={`shrink-0 rounded-sm bg-surface-raised px-1.5 py-px text-app-10 ${
        tone === "warning" ? "text-warning" : "text-subtle"
      }`}
    >
      {children}
    </span>
  );
}

function worktreeName(path: string): string {
  return path.split("/").filter((segment) => segment.length > 0).at(-1) ?? path;
}

/** Splits a formatted size into value and unit for display typography. */
function splitBytes(bytes: number): [value: string, unit: string] {
  const [value = "0", unit = "B"] = formatWorktreeBytes(bytes).split(" ");
  return [value, unit];
}

function WorktreeRow({
  worktree,
  size,
  shareBase,
  barColor,
  selected,
  measuring,
  onSelect,
  onRemoveRequest,
  onMeasureRequest,
}: {
  worktree: WorktreeRecord;
  size?: WorktreeSizeState;
  /** Measured total of the repository; drives the share figure. */
  shareBase: number;
  barColor: string;
  selected: boolean;
  /** An on-demand measurement for this worktree is in flight. */
  measuring: boolean;
  onSelect: () => void;
  onRemoveRequest?: () => void;
  /** Main worktrees only: start an on-demand measurement. */
  onMeasureRequest?: () => void;
}) {
  const reasonText = worktree.blockingReasons
    // Main's identity is carried by the blue tag, not the blocking reason.
    .filter((reason) => !(worktree.kind === "main" && reason === "main"))
    .map((reason) => WORKTREE_BLOCKING_REASON_LABELS[reason])
    .join(" · ");

  const measurable = !worktree.bare && !worktree.missing && !worktree.prunable;
  const measured = measurable && size !== undefined && !size.failed;
  const share =
    measured && shareBase > 0 ? Math.max(1, Math.round((size!.bytes / shareBase) * 100)) : null;
  const [sizeValue, sizeUnit] = measured ? splitBytes(size!.bytes) : ["", ""];

  const hasBadges =
    worktree.dirty ||
    worktree.hasUntracked ||
    worktree.locked ||
    worktree.prunable ||
    worktree.hasSubmodules ||
    worktree.projectNames.length > 0 ||
    worktree.liveRunProjectNames.length > 0 ||
    worktree.runningTerminalProjectNames.length > 0;

  return (
    <li
      data-worktree-path={worktree.path}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`cursor-pointer border-b border-border px-1 py-4 transition-colors last:border-b-0 hover:bg-surface ${
        selected ? "bg-surface" : ""
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
          <span className="truncate text-app-13 font-medium text-fg" title={worktree.path}>
            {worktreeName(worktree.path)}
          </span>
          {worktree.kind === "main" ? (
            <span className="shrink-0 text-app-11 text-skill-reference">Main</span>
          ) : null}
          <span className="flex items-center gap-1 font-mono text-app-11 text-subtle">
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
          {worktree.kind === "main" ? null : worktree.cleanupCandidate ? (
            <span className="text-app-11 text-success">Cleanup candidate</span>
          ) : (
            <span className="text-app-11 text-warning" title={reasonText}>
              Not removable{reasonText === "" ? "" : ` — ${reasonText}`}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-baseline gap-2.5 tabular-nums">
          {!measurable ? null : worktree.kind === "main" ? (
            measuring ? (
              <span className="text-app-11 text-subtle">Calculating size…</span>
            ) : size === undefined ? (
              <MeasureButton label="Calculate" onClick={onMeasureRequest} />
            ) : size.failed ? (
              <>
                <span className="text-app-11 text-warning">Size unavailable</span>
                <MeasureButton label="Recalculate" onClick={onMeasureRequest} />
              </>
            ) : (
              <>
                <span className="flex items-baseline" style={{ color: barColor }}>
                  <span className="text-[26px] font-semibold leading-none tracking-[-0.02em]">
                    ~{sizeValue}
                  </span>
                  <span className="ml-1 text-app-12 font-medium text-subtle">{sizeUnit}</span>
                </span>
                {size.incomplete ? (
                  <span className="text-app-10 text-warning">incomplete</span>
                ) : null}
                <MeasureButton label="Recalculate" onClick={onMeasureRequest} />
              </>
            )
          ) : size === undefined ? (
            <span className="text-app-11 text-subtle">Calculating size…</span>
          ) : size.failed ? (
            <span className="text-app-11 text-warning">Size unavailable</span>
          ) : (
            <>
              <span className="flex items-baseline" style={{ color: barColor }}>
                <span className="text-[26px] font-semibold leading-none tracking-[-0.02em]">
                  ~{sizeValue}
                </span>
                <span className="ml-1 text-app-12 font-medium text-subtle">{sizeUnit}</span>
              </span>
              {size.incomplete ? <span className="text-app-10 text-warning">incomplete</span> : null}
            </>
          )}
          {share !== null ? (
            <span className="w-8 text-right text-app-11 text-subtle">{share}%</span>
          ) : null}
        </div>
      </div>

      {hasBadges || (worktree.cleanupCandidate && onRemoveRequest !== undefined) ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
          {worktree.cleanupCandidate && onRemoveRequest !== undefined ? (
            <button
              type="button"
              onClick={(event) => {
                // Removing must not change the row selection.
                event.stopPropagation();
                onRemoveRequest();
              }}
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-app-11 text-danger transition-colors hover:bg-danger/10"
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
/** Quiet on-demand measurement trigger for main worktree rows. */
function MeasureButton({ label, onClick }: { label: string; onClick?: () => void }) {
  if (onClick === undefined) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        // Measuring must not change the row selection.
        event.stopPropagation();
        onClick();
      }}
      className="rounded border border-border px-1.5 py-0.5 text-app-10 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
    >
      {label}
    </button>
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
  selection,
  measuringPaths,
  onMeasureRequest,
  onSelectRepository,
  onSelectWorktree,
}: {
  entry: WorktreeRepositoryEntry;
  pruning: boolean;
  pruneError: string | null;
  onPruneRequest: (entry: WorktreeRepositoryEntry) => void;
  sizes: Map<string, WorktreeSizeState>;
  removeMessage: { message: string; tone: "danger" | "success" } | null;
  onRemoveRequest: (worktree: WorktreeRecord) => void;
  selection: WorktreeSelection | null;
  measuringPaths: ReadonlySet<string>;
  onMeasureRequest: (worktree: WorktreeRecord) => void;
  onSelectRepository: () => void;
  onSelectWorktree: (worktree: WorktreeRecord) => void;
}) {
  const prunable = prunableWorktrees(entry);
  const sortedWorktrees = [...entry.worktrees].sort((a, b) => compareWorktreeRecords(a, b, sizes));
  const repositorySelected =
    selection?.commonDirectory === entry.commonDirectory && selection.worktreePath === null;

  const measuredSizes = entry.worktrees
    .map((worktree) => sizes.get(worktree.path))
    .filter((size): size is WorktreeSizeState => size !== undefined && !size.failed);
  const totalBytes = measuredSizes.reduce((sum, size) => sum + size.bytes, 0);
  const barColor = repositoryColor(entry.commonDirectory);

  return (
    <section aria-label={`Repository ${entry.projects.join(", ")}`}>
      <button
        type="button"
        data-common-directory={entry.commonDirectory}
        aria-current={repositorySelected ? "true" : undefined}
        onClick={onSelectRepository}
        title={entry.commonDirectory}
        className={`block w-full rounded-sm px-1 text-left transition-colors hover:bg-surface ${
          repositorySelected ? "bg-surface" : ""
        }`}
      >
        <div className="flex min-w-0 items-baseline gap-3 border-b border-border-strong pb-2">
          <span className="min-w-0 truncate text-app-11 font-medium uppercase tracking-[0.12em] text-muted">
            {entry.projects.join(", ")}
          </span>
          <span className="shrink-0 text-app-11 text-subtle">
            {entry.worktrees.length === 1 ? "1 worktree" : `${entry.worktrees.length} worktrees`}
          </span>
          {measuredSizes.length > 0 ? (
            <span className="ml-auto shrink-0 text-app-12 tabular-nums text-muted">
              ~{formatWorktreeBytes(totalBytes)}
            </span>
          ) : null}
        </div>
      </button>
      <ul>
        {[
          // Main worktrees pin to the top; the rest sort cleanup-first.
          ...sortedWorktrees.filter((worktree) => worktree.kind === "main"),
          ...sortedWorktrees.filter((worktree) => worktree.kind !== "main"),
        ].map((worktree) => (
          <WorktreeRow
            key={worktree.path}
            worktree={worktree}
            size={sizes.get(worktree.path)}
            shareBase={totalBytes}
            barColor={barColor}
            selected={selection?.worktreePath === worktree.path}
            measuring={measuringPaths.has(worktree.path)}
            onSelect={() => onSelectWorktree(worktree)}
            onRemoveRequest={
              worktree.cleanupCandidate ? () => onRemoveRequest(worktree) : undefined
            }
            onMeasureRequest={
              worktree.kind === "main" ? () => onMeasureRequest(worktree) : undefined
            }
          />
        ))}
      </ul>
      {removeMessage !== null ? (
        <div className="border-b border-border px-1 py-2.5">
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
        <div className="border-b border-border px-1 py-2.5">
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
      className="flex items-center gap-3 border-b border-border px-1 py-3"
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
  worktree,
  size,
  deleteBranch,
  removing,
  onDeleteBranchChange,
  onCancel,
  onConfirm,
}: {
  worktree: WorktreeRecord;
  size?: WorktreeSizeState;
  deleteBranch: boolean;
  removing: boolean;
  onDeleteBranchChange: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const sizeText =
    size === undefined || size.failed
      ? null
      : `~${formatWorktreeBytes(size.bytes)}${size.incomplete ? " (at least)" : ""}`;
  const offerBranchDeletion = worktree.branchLocal && worktree.branch !== null;

  return (
    <ConfirmDialog
      title={`Remove ${worktreeName(worktree.path)}?`}
      message={
        sizeText === null
          ? "The directory will be permanently deleted."
          : `${sizeText} will be permanently deleted.`
      }
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
          <span>Also delete branch</span>
        </label>
      ) : null}
    </ConfirmDialog>
  );
}

function StatChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 text-app-11 tabular-nums text-muted">
      {children}
    </span>
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
  /** Paths with an on-demand (main worktree) measurement in flight. */
  const [measuringPaths, setMeasuringPaths] = useState<ReadonlySet<string>>(() => new Set());
  // Row selection: clicking a row (or repository header) highlights it; a
  // rescan or removal clears the selection when its target disappears.
  const [selection, setSelection] = useState<WorktreeSelection | null>(null);
  const listPaneRef = useRef<HTMLDivElement | null>(null);

  const startSizeScan = useCallback(
    (result: WorktreeScanResult, options?: { force?: boolean }) => {
      const start = api.worktreeSizesStart;
      const cancel = api.worktreeSizesCancel;
      if (sizeGenerationRef.current !== null && cancel !== undefined) {
        void cancel(sizeGenerationRef.current);
      }
      if (start === undefined) return;
      // Main worktrees are the expensive, non-actionable measurements: they
      // are never scanned automatically and only measured on demand per row.
      // The scanner's cache republishes still-fresh results instantly.
      const targets: WorktreeSizeTarget[] = [];
      for (const entry of result.entries) {
        if (entry.kind !== "repository") continue;
        for (const worktree of entry.worktrees) {
          if (worktree.kind === "main" || worktree.bare || worktree.missing || worktree.prunable) {
            continue;
          }
          targets.push({ commonDirectory: entry.commonDirectory, worktreePath: worktree.path });
        }
      }
      if (targets.length === 0) {
        sizeGenerationRef.current = null;
        setSizeProgress(null);
        return;
      }
      void start(targets, { force: options?.force === true })
        .then((started) => {
          sizeGenerationRef.current = started.generation;
          setSizeProgress({ completed: 0, total: targets.length });
        })
        .catch(() => {
          sizeGenerationRef.current = null;
          setSizeProgress(null);
        });
    },
    [api],
  );

  /** On-demand measurement of a single (main) worktree, always forced. */
  const measureWorktree = useCallback(
    (commonDirectory: string, worktreePath: string) => {
      const start = api.worktreeSizesStart;
      if (start === undefined) return;
      setMeasuringPaths((current) => new Set(current).add(worktreePath));
      void start([{ commonDirectory, worktreePath }], { force: true })
        .then((started) => {
          sizeGenerationRef.current = started.generation;
          setSizeProgress({ completed: 0, total: 1 });
        })
        .catch(() => {
          setMeasuringPaths((current) => {
            const next = new Set(current);
            next.delete(worktreePath);
            return next;
          });
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
    if (result.scan !== null) startSizeScan(result.scan, { force: true });
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
      setMeasuringPaths((current) => {
        if (!current.has(event.worktreePath)) return current;
        const next = new Set(current);
        next.delete(event.worktreePath);
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

  // Clear the selection when a rescan or removal makes its target disappear.
  const selectionExists =
    selection !== null &&
    scan !== null &&
    scan.entries.some(
      (entry) =>
        entry.kind === "repository" &&
        entry.commonDirectory === selection.commonDirectory &&
        (selection.worktreePath === null ||
          entry.worktrees.some((worktree) => worktree.path === selection.worktreePath)),
    );
  useEffect(() => {
    if (selection !== null && !selectionExists) setSelection(null);
  }, [selection, selectionExists]);

  // Chart-driven selection scrolls the matching list row into view.
  // (happy-dom in tests may not implement scrollIntoView, hence the `?.()`.)
  useEffect(() => {
    if (selection === null) return;
    const pane = listPaneRef.current;
    if (pane === null) return;
    const attribute =
      selection.worktreePath === null ? "data-common-directory" : "data-worktree-path";
    const value = selection.worktreePath ?? selection.commonDirectory;
    for (const element of pane.querySelectorAll(`[${attribute}]`)) {
      if (element.getAttribute(attribute) === value) {
        element.scrollIntoView?.({ block: "nearest" });
        break;
      }
    }
  }, [selection]);

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

  let measuredCount = 0;
  let totalBytes = 0;
  let anyIncomplete = false;
  for (const size of worktreeSizes.values()) {
    if (size.failed) continue;
    measuredCount += 1;
    totalBytes += size.bytes;
    if (size.incomplete) anyIncomplete = true;
  }

  // Main worktrees measure on demand only, so the hero total may exclude
  // them; the copy must never read as a complete total in that case.
  let unmeasuredMainCount = 0;
  for (const entry of scan?.entries ?? []) {
    if (entry.kind !== "repository") continue;
    for (const worktree of entry.worktrees) {
      if (worktree.kind !== "main" || worktree.bare || worktree.missing || worktree.prunable) {
        continue;
      }
      const size = worktreeSizes.get(worktree.path);
      if (size === undefined || size.failed) unmeasuredMainCount += 1;
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
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="flex shrink-0 items-center gap-2 text-app-15 font-semibold text-fg">
          <GitBranch className="h-4 w-4 text-subtle" />
          {WORKTREES_TAB_LABEL}
        </h1>
        <p className="shrink-0 text-app-12 text-subtle">Git worktrees reachable from your Projects</p>
        {scan !== null ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatChip>
              {repositoryCount} {repositoryCount === 1 ? "repository" : "repositories"}
            </StatChip>
            <StatChip>{linkedWorktreeCount} linked</StatChip>
            <StatChip>{removableCount} removable</StatChip>
            {sizeProgress !== null && sizeProgress.completed < sizeProgress.total ? (
              <StatChip>
                measuring {sizeProgress.completed}/{sizeProgress.total}
              </StatChip>
            ) : null}
          </div>
        ) : null}
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          data-testid="worktrees-hero-pane"
          className="px-6 pt-10 pb-4"
        >
          <div className="mx-auto w-full max-w-5xl">
            <div className="text-app-11 uppercase tracking-[0.14em] text-subtle">
              {unmeasuredMainCount > 0
                ? "Linked worktree storage, estimated"
                : "Worktree storage, estimated"}
            </div>
            {measuredCount === 0 ? (
              <div className="mt-4 text-app-13 text-subtle">
                {sizeProgress !== null && sizeProgress.completed < sizeProgress.total
                  ? `Calculating sizes ${sizeProgress.completed}/${sizeProgress.total}…`
                  : "Calculating sizes…"}
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-end gap-x-10 gap-y-4">
                <div>
                  <span className="text-[84px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-fg">
                    {splitBytes(totalBytes)[0]}
                  </span>
                  <span className="ml-2 text-app-22 font-medium text-subtle">
                    {splitBytes(totalBytes)[1]}
                  </span>
                </div>
                <div className="ml-auto pb-1 text-right">
                  <div className="text-app-26 font-semibold tabular-nums text-success">
                    ~{formatWorktreeBytes(releasableBytes)}
                  </div>
                  <div className="mt-0.5 text-app-11 text-subtle">
                    releasable — {removableCount}{" "}
                    {removableCount === 1 ? "cleanup candidate" : "cleanup candidates"}
                  </div>
                </div>
              </div>
            )}
            {anyIncomplete ? (
              <p className="mt-3 text-app-11 text-subtle">
                Some entries were unreadable; totals are a lower bound.
              </p>
            ) : null}
            {unmeasuredMainCount > 0 && measuredCount > 0 ? (
              <p className="mt-3 text-app-11 text-subtle">
                Main not measured — use Calculate on a main worktree row to include it.
              </p>
            ) : null}
          </div>
        </div>
        <div
          data-testid="worktrees-list-pane"
          ref={listPaneRef}
          className="mx-auto w-full max-w-5xl px-6 py-6"
        >
          <div className="flex flex-col gap-10">
            {scan.entries.map((entry) =>
              entry.kind === "repository" ? (
                <RepositoryGroupView
                  key={entry.commonDirectory}
                  entry={entry}
                  pruning={pruning}
                  pruneError={
                    pruneError?.commonDirectory === entry.commonDirectory
                      ? pruneError.message
                      : null
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
                  selection={selection}
                  measuringPaths={measuringPaths}
                  onMeasureRequest={(worktree) =>
                    measureWorktree(entry.commonDirectory, worktree.path)
                  }
                  onSelectRepository={() => {
                    setSelection({ commonDirectory: entry.commonDirectory, worktreePath: null });
                  }}
                  onSelectWorktree={(worktree) => {
                    setSelection({
                      commonDirectory: entry.commonDirectory,
                      worktreePath: worktree.path,
                    });
                  }}
                />
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
