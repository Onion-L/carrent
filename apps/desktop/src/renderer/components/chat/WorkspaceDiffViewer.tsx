import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChangedFile } from "../../mock/uiShellData";

export type WorkspaceDiffSnapshot = {
  baseRevision: string;
  capturedAt: string;
  patch: string;
  truncated: boolean;
};

type WorkspaceDiffViewerProps = {
  snapshot: WorkspaceDiffSnapshot;
  files: ChangedFile[];
  onClose: () => void;
};

export type DiffLineClass =
  | "header"
  | "hunk"
  | "addition"
  | "deletion"
  | "context"
  | "empty";

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
}: {
  block: DiffFileBlock;
  file?: ChangedFile;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const additions = file?.additions ?? 0;
  const deletions = file?.deletions ?? 0;

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-border last:mb-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 bg-surface px-3 py-2 text-left transition hover:bg-surface-hover"
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

      {expanded && (
        <div className="border-t border-border bg-bg px-3 py-2 font-mono text-app-13 leading-5">
          {block.lines.map((line, index) => (
            <DiffLine key={`${index}-${line.slice(0, 40)}`} line={line} />
          ))}
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
}: {
  snapshot: WorkspaceDiffSnapshot;
  files: ChangedFile[];
}): ReactNode {
  const blocks = useMemo(() => splitPatchIntoFileBlocks(snapshot.patch), [snapshot.patch]);
  const hasVisiblePatch = blocks.length > 0;
  const hasOmitted = files.some((file) => file.omitted);
  const allBinaryOrOmitted = files.length > 0 && files.every((file) => file.binary || file.omitted);

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

  return (
    <div className="flex max-h-full flex-col">
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
            {blocks.map((block, index) => (
              <FileDiffBlock
                key={`${block.path}-${index}`}
                block={block}
                file={fileByPath.get(block.path)}
                defaultExpanded={index === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkspaceDiffViewer({ snapshot, files, onClose }: WorkspaceDiffViewerProps) {
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
        <WorkspaceDiffContent snapshot={snapshot} files={files} />
      </div>
    </div>
  );
}
