import type { ReactNode } from "react";

export function ChatHeader({ title, leading }: { title?: string; leading?: ReactNode }) {
  return (
    <header
      className="relative flex shrink-0 flex-col items-center justify-center bg-bg px-14"
      style={{ height: "max(env(titlebar-area-height, 38px), 48px)" }}
    >
      {leading ? (
        <div className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {leading}
        </div>
      ) : null}
      <h1 className="max-w-full truncate text-center text-app-13 font-semibold text-muted">
        {title ?? "New Chat"}
      </h1>
    </header>
  );
}
