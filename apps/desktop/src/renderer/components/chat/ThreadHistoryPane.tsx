import { Plus } from "lucide-react";
import { useState } from "react";
import { currentProject } from "../../mock/uiShellData";
import { formatRelativeTime } from "../../lib/formatRelativeTime";

export function ThreadHistoryPane() {
  const projectThreads = currentProject.threads;
  const [activeThreadId, setActiveThreadId] = useState(
    projectThreads.find((t) => t.active)?.id ?? projectThreads[0]?.id,
  );

  return (
    <div className="flex h-full w-[220px] flex-col border-r border-border bg-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-[12px] font-medium uppercase tracking-wider text-subtle">
          {currentProject.name}
        </span>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-raised hover:text-fg">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-auto px-2">
        {projectThreads.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-[13px] text-subtle">No threads yet</p>
            <p className="mt-1 text-[12px] text-subtle">Start a new thread to begin</p>
          </div>
        ) : (
          projectThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                className={`mb-1 flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition ${
                  isActive
                    ? "bg-surface-hover text-fg"
                    : "text-muted hover:bg-surface-raised hover:text-fg"
                }`}
              >
                <span className="text-[13px] font-medium">{thread.title}</span>
                <span className="text-[11px] text-subtle">
                  {formatRelativeTime(thread.updatedAt)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
