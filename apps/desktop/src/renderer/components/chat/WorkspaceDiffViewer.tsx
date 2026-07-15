import { ChevronDown, ChevronRight, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChangedFile } from "../../mock/uiShellData";

export type WorkspaceDiffSnapshot = {
  baseRevision: string;
  capturedAt: string;
  patch: string;
  truncated: boolean;
};

export type WorkspaceDiffReviewTarget =
  | { path: string; scope: "file" }
  | { path: string; scope: "hunk"; header: string };

type WorkspaceDiffViewerProps = {
  snapshot: WorkspaceDiffSnapshot;
  files: ChangedFile[];
  onClose: () => void;
  onCreateFollowUp?: (content: string) => void;
};

export type DiffLineClass = "header" | "hunk" | "addition" | "deletion" | "context" | "empty";

export function classifyDiffLine(line: string): DiffLineClass {
  if (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename ") ||
    line.startsWith("Binary files ")
  ) {
    return "header";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "addition";
  }
  if (line.startsWith("-")) {
    return "deletion";
  }
  if (line.length === 0) {
    return "empty";
  }
  return "context";
}

export type DiffFileBlock = {
  path: string;
  lines: string[];
};

export type DiffHunk = {
  header: string;
  lines: string[];
};

export function extractFilePathFromHeader(headerLines: string[]): string {
  const diffGitLine = headerLines.find((line) => line.startsWith("diff --git "));
  if (diffGitLine) {
    const match = /diff --git .* b\/(.+)$/.exec(diffGitLine);
    if (match?.[1]) {
      return match[1];
    }
  }

  const plusLine = headerLines.find((line) => line.startsWith("+++ b"));
  if (plusLine) {
    return plusLine.slice("+++ b/".length);
  }

  return "unknown";
}

export function splitPatchIntoFileBlocks(patch: string): DiffFileBlock[] {
  const allLines = patch.split("\n");
  const blocks: DiffFileBlock[] = [];
  let currentLines: string[] = [];

  for (const line of allLines) {
    if (line.startsWith("diff --git ")) {
      if (currentLines.length > 0) {
        blocks.push({
          path: extractFilePathFromHeader(currentLines),
          lines: currentLines,
        });
      }
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    blocks.push({
      path: extractFilePathFromHeader(currentLines),
      lines: currentLines,
    });
  }

  return blocks;
}

export function splitFileBlockIntoHunks(block: DiffFileBlock): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of block.lines) {
    if (line.startsWith("@@")) {
      if (current) {
        hunks.push(current);
      }
      current = { header: line, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    hunks.push(current);
  }

  return hunks;
}

export function buildWorkspaceDiffFollowUp({
  snapshot,
  reviewNote,
  targets,
}: {
  snapshot: WorkspaceDiffSnapshot;
  reviewNote: string;
  targets: WorkspaceDiffReviewTarget[];
}): string {
  const selectedChanges = targets.map((target) => {
    if (target.scope === "file") {
      return `- Entire file: ${JSON.stringify(target.path)}`;
    }

    return `- Hunk in ${JSON.stringify(target.path)}: ${JSON.stringify(target.header)}`;
  });

  return [
    "Follow up on this workspace diff review.",
    "",
    "Review note:",
    reviewNote.trim(),
    "",
    "Snapshot:",
    `- Base revision: ${snapshot.baseRevision}`,
    `- Captured at: ${snapshot.capturedAt}`,
    "- This may include pre-existing or external changes.",
    "",
    "Selected changes:",
    ...selectedChanges,
    "",
    "Inspect the current workspace before editing because it may have changed since this snapshot.",
  ].join("\n");
}

function DiffLine({ line }: { line: string }) {
  const className = classifyDiffLine(line);
  switch (className) {
    case "header":
      return <div className="text-fg">{line}</div>;
    case "hunk":
      return <div className="text-muted">{line}</div>;
    case "addition":
      return (
        <div className="bg-success/5 text-success">
          <span className="inline-block w-4 shrink-0 select-none text-success/60">+</span>
          {line.slice(1)}
        </div>
      );
    case "deletion":
      return (
        <div className="bg-danger/5 text-danger">
          <span className="inline-block w-4 shrink-0 select-none text-danger/60">-</span>
          {line.slice(1)}
        </div>
      );
    case "context":
      return (
        <div className="text-fg">
          <span className="inline-block w-4 shrink-0 select-none text-muted"> </span>
          {line.slice(1)}
        </div>
      );
    case "empty":
      return (
        <div className="text-fg">
          <span className="inline-block w-4 shrink-0 select-none text-muted"> </span>
          &nbsp;
        </div>
      );
  }
}

function FileDiffBlock({
  block,
  file,
  defaultExpanded,
  reviewEnabled,
  fileSelected,
  selectedHunkKeys,
  onFileSelectionChange,
  onHunkSelectionChange,
}: {
  block: DiffFileBlock;
  file?: ChangedFile;
  defaultExpanded: boolean;
  reviewEnabled: boolean;
  fileSelected: boolean;
  selectedHunkKeys: ReadonlySet<string>;
  onFileSelectionChange: (path: string, selected: boolean) => void;
  onHunkSelectionChange: (path: string, header: string, selected: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const additions = file?.additions ?? 0;
  const deletions = file?.deletions ?? 0;
  const hunks = useMemo(() => splitFileBlockIntoHunks(block), [block]);
  const firstHunkIndex = block.lines.findIndex((line) => line.startsWith("@@"));
  const selectable = reviewEnabled && block.path !== "unknown" && !!file && !file.isFolder;

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-border last:mb-0">
      <div className="flex items-center bg-surface">
        {selectable ? (
          <input
            type="checkbox"
            checked={fileSelected}
            onChange={(event) => onFileSelectionChange(block.path, event.target.checked)}
            aria-label={`Select entire file ${block.path}`}
            className="ml-3 h-4 w-4 shrink-0 accent-fg outline-none focus-visible:ring-2 focus-visible:ring-fg"
          />
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg"
        >
          <div className="flex min-w-0 items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
            )}
            <span className="min-w-0 truncate font-mono text-app-13 text-fg" title={block.path}>
              {block.path}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-app-12">
            {file?.binary ? (
              <span className="text-subtle">Binary</span>
            ) : (
              <>
                <span className="text-success">+{additions}</span>
                <span className="text-danger">-{deletions}</span>
              </>
            )}
          </div>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border bg-bg px-3 py-2 font-mono text-app-13 leading-5">
          {(firstHunkIndex < 0 ? block.lines : block.lines.slice(0, firstHunkIndex)).map(
            (line, index) => (
              <DiffLine key={`${index}-${line.slice(0, 40)}`} line={line} />
            ),
          )}
          {hunks.map((hunk, index) => {
            const key = getHunkSelectionKey(block.path, hunk.header);
            return (
              <div key={`${index}-${hunk.header}`}>
                {selectable ? (
                  <div className="flex min-w-0 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedHunkKeys.has(key)}
                      onChange={(event) =>
                        onHunkSelectionChange(block.path, hunk.header, event.target.checked)
                      }
                      aria-label={`Select hunk ${hunk.header} in ${block.path}`}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-fg outline-none focus-visible:ring-2 focus-visible:ring-fg"
                    />
                    <div className="min-w-0">
                      <DiffLine line={hunk.header} />
                    </div>
                  </div>
                ) : (
                  <DiffLine line={hunk.header} />
                )}
                {hunk.lines.slice(1).map((line, lineIndex) => (
                  <DiffLine key={`${lineIndex}-${line.slice(0, 40)}`} line={line} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function abbreviateRevision(revision: string): string {
  return revision.slice(0, 7);
}

function formatCapturedAt(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

export function WorkspaceDiffContent({
  snapshot,
  files,
  onCreateFollowUp,
}: {
  snapshot: WorkspaceDiffSnapshot;
  files: ChangedFile[];
  onCreateFollowUp?: (content: string) => void;
}): ReactNode {
  const blocks = useMemo(() => splitPatchIntoFileBlocks(snapshot.patch), [snapshot.patch]);
  const hasOmitted = files.some((file) => file.omitted);
  const allBinaryOrOmitted = files.length > 0 && files.every((file) => file.binary || file.omitted);
  const [reviewNote, setReviewNote] = useState("");
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(() => new Set());
  const [selectedHunkKeys, setSelectedHunkKeys] = useState<Set<string>>(() => new Set());

  const fileCount = files.filter((file) => !file.isFolder).length;
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  const fileByPath = useMemo(() => {
    const map = new Map<string, ChangedFile>();
    for (const file of files) {
      map.set(file.path, file);
    }
    return map;
  }, [files]);

  const knownBlockPaths = useMemo(
    () => new Set(blocks.filter((block) => block.path !== "unknown").map((block) => block.path)),
    [blocks],
  );
  const visibleBlocks = useMemo(
    () =>
      blocks.filter((block) => {
        const file = fileByPath.get(block.path);
        return block.path === "unknown" || (!file?.binary && !file?.omitted);
      }),
    [blocks, fileByPath],
  );
  const compactFiles = useMemo(
    () =>
      files.filter(
        (file) =>
          !file.isFolder && (file.binary || file.omitted || !knownBlockPaths.has(file.path)),
      ),
    [files, knownBlockPaths],
  );
  const hasVisiblePatch = visibleBlocks.length > 0;

  const handleFileSelectionChange = (path: string, selected: boolean) => {
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
    setSelectedHunkKeys((current) => {
      const next = new Set(current);
      for (const key of next) {
        if (key.startsWith(`${path}\u0000`)) {
          next.delete(key);
        }
      }
      return next;
    });
  };

  const handleHunkSelectionChange = (path: string, header: string, selected: boolean) => {
    if (selected) {
      setSelectedFilePaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
    setSelectedHunkKeys((current) => {
      const next = new Set(current);
      const key = getHunkSelectionKey(path, header);
      if (selected) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const buildSelectedTargets = (): WorkspaceDiffReviewTarget[] => {
    const targets: WorkspaceDiffReviewTarget[] = [];
    const added = new Set<string>();

    for (const file of files) {
      if (file.isFolder || added.has(file.path)) {
        continue;
      }
      if (selectedFilePaths.has(file.path)) {
        targets.push({ path: file.path, scope: "file" });
        added.add(file.path);
        continue;
      }

      for (const block of blocks) {
        if (block.path !== file.path) {
          continue;
        }
        for (const hunk of splitFileBlockIntoHunks(block)) {
          const key = getHunkSelectionKey(file.path, hunk.header);
          if (selectedHunkKeys.has(key) && !added.has(key)) {
            targets.push({ path: file.path, scope: "hunk", header: hunk.header });
            added.add(key);
          }
        }
      }
    }

    return targets;
  };

  const canCreateFollowUp =
    !!onCreateFollowUp &&
    reviewNote.trim().length > 0 &&
    (selectedFilePaths.size > 0 || selectedHunkKeys.size > 0);

  return (
    <div className="flex h-full max-h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-app-12 text-muted">
          <span>
            Base:{" "}
            <span className="font-mono text-fg">{abbreviateRevision(snapshot.baseRevision)}</span>
          </span>
          <span>Captured: {formatCapturedAt(snapshot.capturedAt)}</span>
          <span>
            {fileCount} file{fileCount === 1 ? "" : "s"}
          </span>
          <span className="text-success">+{totalAdditions}</span>
          <span className="text-danger">-{totalDeletions}</span>
        </div>
        <p className="mt-1 text-app-12 text-subtle">
          Snapshot against HEAD after the run; may include pre-existing or external changes.
        </p>
        {(snapshot.truncated || hasOmitted) && (
          <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-app-12 text-warning">
            {snapshot.truncated && hasOmitted
              ? "Diff truncated and some files omitted."
              : snapshot.truncated
                ? "Diff truncated."
                : "Some files omitted."}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {allBinaryOrOmitted || !hasVisiblePatch ? (
          <div className="font-mono text-app-13 text-subtle">
            {allBinaryOrOmitted
              ? "Every changed file is binary or omitted, so no text diff is available."
              : "No diff text is available."}
          </div>
        ) : (
          <div>
            {visibleBlocks.map((block, index) => (
              <FileDiffBlock
                key={`${block.path}-${index}`}
                block={block}
                file={fileByPath.get(block.path)}
                defaultExpanded={index === 0}
                reviewEnabled={!!onCreateFollowUp}
                fileSelected={selectedFilePaths.has(block.path)}
                selectedHunkKeys={selectedHunkKeys}
                onFileSelectionChange={handleFileSelectionChange}
                onHunkSelectionChange={handleHunkSelectionChange}
              />
            ))}
          </div>
        )}
        {compactFiles.length > 0 ? (
          <div className={hasVisiblePatch ? "mt-4" : "mt-3"}>
            <h3 className="mb-2 text-app-12 font-medium text-muted">Files without visible diff</h3>
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {compactFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex min-h-9 items-center gap-2 px-3 py-2 text-app-12 text-fg"
                >
                  {onCreateFollowUp ? (
                    <input
                      type="checkbox"
                      checked={selectedFilePaths.has(file.path)}
                      onChange={(event) =>
                        handleFileSelectionChange(file.path, event.target.checked)
                      }
                      aria-label={`Select entire file ${file.path}`}
                      className="h-4 w-4 shrink-0 accent-fg outline-none focus-visible:ring-2 focus-visible:ring-fg"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
                    {file.path}
                  </span>
                  <span className="shrink-0 text-subtle">
                    {file.binary ? "Binary" : file.omitted ? "Omitted" : "Summary only"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {onCreateFollowUp ? (
        <div className="shrink-0 border-t border-border bg-bg px-4 py-3">
          <textarea
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="What should change?"
            aria-label="Review note"
            rows={3}
            className="w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-app-13 leading-5 text-fg outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-fg"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canCreateFollowUp}
              onClick={() => {
                const targets = buildSelectedTargets();
                if (targets.length === 0 || !reviewNote.trim()) {
                  return;
                }
                onCreateFollowUp(buildWorkspaceDiffFollowUp({ snapshot, reviewNote, targets }));
              }}
              className="flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-app-12 font-medium text-bg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span>Add follow-up</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getHunkSelectionKey(path: string, header: string): string {
  return `${path}\u0000${header}`;
}

export function WorkspaceDiffViewer({
  snapshot,
  files,
  onClose,
  onCreateFollowUp,
}: WorkspaceDiffViewerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="flex h-full w-[32rem] min-w-0 shrink-0 flex-col border-l border-border bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace diff"
    >
      <div
        className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"
        style={{ paddingTop: "env(titlebar-area-height, 12px)" }}
      >
        <h2 className="text-app-15 font-medium text-fg">Workspace diff</h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close workspace diff"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceDiffContent
          snapshot={snapshot}
          files={files}
          onCreateFollowUp={onCreateFollowUp}
        />
      </div>
    </div>
  );
}
