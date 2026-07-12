import { X } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ") || line.startsWith("similarity index ") || line.startsWith("rename ") || line.startsWith("Binary files ")) {
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
  const lines = useMemo(() => snapshot.patch.split("\n"), [snapshot.patch]);
  const hasVisiblePatch = lines.length > 0 && !(lines.length === 1 && lines[0] === "");
  const hasOmitted = files.some((file) => file.omitted);
  const allBinaryOrOmitted = files.length > 0 && files.every((file) => file.binary || file.omitted);

  const fileCount = files.filter((file) => !file.isFolder).length;
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div className="flex max-h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-app-12 text-muted">
          <span>
            Base: <span className="font-mono text-fg">{abbreviateRevision(snapshot.baseRevision)}</span>
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

      <div className="flex-1 overflow-auto px-4 py-3 font-mono text-app-13 leading-5">
        {allBinaryOrOmitted || !hasVisiblePatch ? (
          <div className="text-subtle">
            {allBinaryOrOmitted
              ? "Every changed file is binary or omitted, so no text diff is available."
              : "No diff text is available."}
          </div>
        ) : (
          <div className="whitespace-pre">
            {lines.map((line, index) => {
              const className = classifyDiffLine(line);
              const key = `${index}-${line.slice(0, 40)}`;
              switch (className) {
                case "header":
                  return (
                    <div key={key} className="text-fg">
                      {line}
                    </div>
                  );
                case "hunk":
                  return (
                    <div key={key} className="text-muted">
                      {line}
                    </div>
                  );
                case "addition":
                  return (
                    <div key={key} className="text-success">
                      {line}
                    </div>
                  );
                case "deletion":
                  return (
                    <div key={key} className="text-danger">
                      {line}
                    </div>
                  );
                case "context":
                  return (
                    <div key={key} className="text-fg">
                      {line}
                    </div>
                  );
                case "empty":
                  return <div key={key}>&nbsp;</div>;
              }
            })}
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg/95"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace diff"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between border-b border-border px-4 py-3"
        style={{ paddingTop: "env(titlebar-area-height, 12px)" }}
        onClick={(event) => event.stopPropagation()}
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

      <div className="flex-1 overflow-hidden p-4" onClick={(event) => event.stopPropagation()}>
        <div className="h-full overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <WorkspaceDiffContent snapshot={snapshot} files={files} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
