import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type {
  AppProjectRecord,
  AppThreadRecord,
  WorkspaceProjectAssociationRecord,
  WorkspaceRecord,
} from "../../../shared/workspacePersistence";
import type { ThreadSearchEntry } from "../../../shared/threadSearch";
import { searchThreads } from "../../lib/threadSearch";
import { MarqueeText } from "../MarqueeText";

type ThreadSearchDialogProps = {
  threads: AppThreadRecord[];
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  onSelect: (entry: ThreadSearchEntry) => void;
  onClose: () => void;
};

export function ThreadSearchDialog({
  threads,
  workspaces,
  projects,
  associations,
  onSelect,
  onClose,
}: ThreadSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const results = useMemo(
    () => searchThreads({ threads, workspaces, projects, associations, query }),
    [associations, projects, query, threads, workspaces],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => setSelectedIndex(0), [query]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Threads"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border-strong bg-surface shadow-xl"
      >
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Search className="h-4 w-4 shrink-0 text-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedIndex((index) =>
                    results.length === 0 ? 0 : (index + 1) % results.length,
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedIndex((index) =>
                    results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const result = results[selectedIndex] ?? results[0];
                  if (result) onSelect(result);
                }
              }}
              placeholder="Search Thread titles"
              aria-label="Search Thread titles"
              className="min-w-0 flex-1 bg-transparent text-app-14 text-fg outline-none placeholder:text-subtle"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => setQuery("")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-app-13 font-medium text-muted">
                {query.trim() ? "No matching Threads" : "No recent Threads"}
              </p>
            </div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.thread.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelect(entry)}
                className={`w-full rounded-md px-3 py-2.5 text-left ${
                  index === selectedIndex
                    ? "bg-surface-hover text-fg"
                    : "text-muted hover:bg-surface-hover hover:text-fg"
                }`}
              >
                <MarqueeText className="block text-app-12 font-medium">
                  {entry.workspaceName} / {entry.projectName} / {entry.thread.title}
                </MarqueeText>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
