export function ChatHeader({ title }: { title?: string }) {
  return (
    <header
      className="relative flex shrink-0 items-center justify-center bg-bg px-14"
      style={{ height: "max(env(titlebar-area-height, 38px), 48px)" }}
    >
      <h1 className="max-w-full truncate text-center text-app-13 font-semibold text-muted">
        {title ?? "New Chat"}
      </h1>
    </header>
  );
}
