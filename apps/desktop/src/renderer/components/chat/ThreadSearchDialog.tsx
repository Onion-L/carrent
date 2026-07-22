import { Pin, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ThreadRecord } from "../../mock/uiShellData";
import { filterProjectThreads } from "../../lib/projectThreads";

type ThreadSearchDialogProps = {
  threads: ThreadRecord[];
  onSelect: (threadId: string) => void;
  onClose: () => void;
};

export function ThreadSearchDialog({ threads, onSelect, onClose }: ThreadSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const results = useMemo(() => filterProjectThreads(threads, query), [threads, query]);

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

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search threads"
        className="flex max-h-[60vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-xl"
      >
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-3">
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
                const target = results[selectedIndex] ?? results[0];
                if (target) {
                  onSelect(target.id);
                }
              }
            }}
            placeholder="Search threads"
            aria-label="Search threads"
            className="min-w-0 flex-1 bg-transparent text-app-14 text-fg outline-none placeholder:text-subtle"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-t border-border/70 px-2 py-2">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-app-12 text-subtle">
              No matching threads
            </div>
          ) : (
            results.map((thread, index) => (
              <button
                key={thread.id}
                type="button"
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelect(thread.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                  index === selectedIndex
                    ? "bg-surface-hover text-fg"
                    : "text-muted hover:bg-surface-hover hover:text-fg"
                }`}
              >
                {thread.pinned ? (
                  <Pin className="h-3.5 w-3.5 shrink-0 text-subtle" />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full border border-subtle/70" />
                )}
                <span className="min-w-0 flex-1 truncate text-app-13 font-medium">
                  {thread.title}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border/70 px-4 py-2 text-app-11 text-subtle">
          <span>Jump to a thread in this project</span>
          <span>Enter to open</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
