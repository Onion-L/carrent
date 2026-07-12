import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FileCode, FileText } from "lucide-react";
import type { Message } from "../../mock/uiShellData";
import { WorkspaceDiffViewer } from "./WorkspaceDiffViewer";

type ChangedFilesMessage = Extract<Message, { type: "changed_files" }>;

function FileIcon({ file }: { file: ChangedFilesMessage["changedFiles"][0] }) {
  if (file.isFolder) return <Folder className="h-4 w-4 text-muted" />;
  if (file.fileType === "swift") return <FileCode className="h-4 w-4 text-[#e87d5a]" />;
  if (file.fileType === "markdown") return <FileText className="h-4 w-4 text-[#8b9dc3]" />;
  return <FileText className="h-4 w-4 text-muted" />;
}

function FileChangeLabel({ file }: { file: ChangedFilesMessage["changedFiles"][0] }) {
  if (file.omitted) {
    return <span className="text-app-12 text-subtle">Omitted</span>;
  }
  if (file.binary) {
    return <span className="text-app-12 text-subtle">Binary</span>;
  }
  return (
    <div className="flex items-center gap-2 text-app-12">
      <span className="text-success">+{file.additions}</span>
      <span className="text-danger">-{file.deletions}</span>
    </div>
  );
}

export function ChangedFilesCard({ message }: { message: ChangedFilesMessage }) {
  const [expanded, setExpanded] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);

  const totalAdditions = message.changedFiles.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = message.changedFiles.reduce((s, f) => s + f.deletions, 0);
  const fileCount = message.changedFiles.filter((f) => !f.isFolder).length;
  const hasSnapshot =
    !!message.snapshot &&
    typeof message.snapshot.baseRevision === "string" &&
    typeof message.snapshot.patch === "string";

  return (
    <>
      <div className="rounded-xl border border-border bg-surface">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-app-13 text-muted transition hover:text-fg"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <span className="font-medium tracking-wide text-muted">WORKSPACE CHANGES</span>
            <span className="text-subtle">({fileCount})</span>
            <span className="ml-2 text-success">+{totalAdditions}</span>
            <span className="text-subtle">/</span>
            <span className="text-danger">-{totalDeletions}</span>
          </button>
          <div className="flex items-center gap-2">
            {hasSnapshot ? (
              <button
                type="button"
                onClick={() => setViewerOpen(true)}
                className="rounded-md px-2.5 py-1 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
              >
                View diff
              </button>
            ) : (
              <span
                className="rounded-md px-2.5 py-1 text-app-12 text-subtle"
                title="This snapshot was captured before diff review was available."
              >
                Diff unavailable
              </span>
            )}
          </div>
        </div>

        {/* File tree */}
        {expanded && (
          <div className="border-t border-border px-4 py-2">
            {message.changedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition hover:bg-surface-hover"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FileIcon file={file} />
                  <span className="min-w-0 truncate text-app-13 text-fg" title={file.path}>
                    {file.path}
                  </span>
                </div>
                {!file.isFolder && <FileChangeLabel file={file} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {viewerOpen && hasSnapshot && (
        <WorkspaceDiffViewer
          snapshot={message.snapshot!}
          files={message.changedFiles}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
}
