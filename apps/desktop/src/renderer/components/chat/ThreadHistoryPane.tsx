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
    <div className="flex h-full w-[220px] flex-col border-r border-[#252525] bg-[#181818]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-[12px] font-medium uppercase tracking-wider text-[#666]">
          {currentProject.name}
        </span>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#888] transition hover:bg-[#252525] hover:text-[#ccc]">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-auto px-2">
        {projectThreads.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-[13px] text-[#555]">No threads yet</p>
            <p className="mt-1 text-[12px] text-[#444]">Start a new thread to begin</p>
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
                    ? "bg-[#2a2a2a] text-[#eee]"
                    : "text-[#999] hover:bg-[#222] hover:text-[#ccc]"
                }`}
              >
                <span className="text-[13px] font-medium">{thread.title}</span>
                <span className="text-[11px] text-[#666]">
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
