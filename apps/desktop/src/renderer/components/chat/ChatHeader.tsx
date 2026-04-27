export function ChatHeader({ title }: { title?: string }) {
  return (
    <header
      className="drag-region flex shrink-0 items-center px-4"
      style={{ height: "env(titlebar-area-height, 38px)" }}
    >
      <h1 className="text-[14px] font-medium text-muted">{title ?? "New Chat"}</h1>
    </header>
  );
}
