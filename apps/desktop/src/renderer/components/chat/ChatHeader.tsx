import { Users } from "lucide-react";

import { THREAD_INSPECTOR_TITLE } from "./ThreadInspectorPane";

export type ChatHeaderInspectorProps = {
  open: boolean;
  taskCount: number;
  onToggle: () => void;
};

export function ChatHeader({
  title,
  inspector,
}: {
  title?: string;
  inspector?: ChatHeaderInspectorProps;
}) {
  return (
    <header
      className="relative flex shrink-0 items-center justify-center bg-bg px-14"
      style={{ height: "max(env(titlebar-area-height, 38px), 48px)" }}
    >
      <h1 className="max-w-full truncate text-center text-app-13 font-semibold text-muted">
        {title ?? "New Chat"}
      </h1>
      {inspector && (
        <div className="absolute inset-y-0 right-3 flex items-center">
          <button
            type="button"
            onClick={inspector.onToggle}
            aria-label={`Toggle ${THREAD_INSPECTOR_TITLE.toLowerCase()} pane`}
            aria-pressed={inspector.open}
            title={THREAD_INSPECTOR_TITLE}
            className={`relative flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 ${
              inspector.open ? "text-fg" : "text-muted hover:text-fg"
            }`}
          >
            <Users className="h-4 w-4" />
            {inspector.taskCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-fg px-0.5 text-app-10 font-semibold leading-none text-bg">
                {inspector.taskCount}
              </span>
            )}
          </button>
        </div>
      )}
    </header>
  );
}
