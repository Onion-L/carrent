import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FileCode, FileText } from "lucide-react";
import type { Message } from "../../mock/uiShellData";

type ChangedFilesMessage = Extract<Message, { type: "changed_files" }>;

function FileIcon({ file }: { file: ChangedFilesMessage["changedFiles"][0] }) {
  if (file.isFolder) return <Folder className="h-4 w-4 text-muted" />;
  if (file.fileType === "swift") return <FileCode className="h-4 w-4 text-[#e87d5a]" />;
  if (file.fileType === "markdown") return <FileText className="h-4 w-4 text-[#8b9dc3]" />;
  return <FileText className="h-4 w-4 text-muted" />;
}

export function ChangedFilesCard({ message }: { message: ChangedFilesMessage }) {
  const [expanded, setExpanded] = useState(true);

  const totalAdditions = message.changedFiles.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = message.changedFiles.reduce((s, f) => s + f.deletions, 0);
  const fileCount = message.changedFiles.filter((f) => !f.isFolder).length;

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-[13px] text-muted transition hover:text-fg"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="font-medium tracking-wide text-muted">CHANGED FILES</span>
          <span className="text-subtle">({fileCount})</span>
          <span className="ml-2 text-success">+{totalAdditions}</span>
          <span className="text-subtle">/</span>
          <span className="text-danger">-{totalDeletions}</span>
        </button>
        <div className="flex items-center gap-2">
          <button className="rounded-md px-2.5 py-1 text-[12px] text-muted transition hover:bg-surface-hover hover:text-fg">
            Collapse all
          </button>
          <button className="rounded-md px-2.5 py-1 text-[12px] text-muted transition hover:bg-surface-hover hover:text-fg">
            View diff
          </button>
        </div>
      </div>

      {/* File tree */}
      {expanded && (
        <div className="border-t border-border px-4 py-2">
          {message.changedFiles.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-surface-hover"
            >
              <div className="flex items-center gap-2">
                <FileIcon file={file} />
                <span className="text-[13px] text-fg">{file.path}</span>
              </div>
              {!file.isFolder && (
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="text-success">+{file.additions}</span>
                  <span className="text-danger">-{file.deletions}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
