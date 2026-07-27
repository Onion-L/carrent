export function ChatHeader({ title, breadcrumb }: { title?: string; breadcrumb?: string }) {
  return (
    <header
      className="relative flex shrink-0 flex-col items-center justify-center bg-bg px-14"
      style={{ height: "max(env(titlebar-area-height, 38px), 48px)" }}
    >
      {breadcrumb && <p className="max-w-full truncate text-app-11 text-subtle">{breadcrumb}</p>}
      <h1 className="max-w-full truncate text-center text-app-13 font-semibold text-muted">
        {title ?? "New Chat"}
      </h1>
    </header>
  );
}
