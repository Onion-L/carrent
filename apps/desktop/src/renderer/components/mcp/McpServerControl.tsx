import { useEffect, useRef, useState } from "react";
import { Server, Check } from "lucide-react";
import { useMcpServer } from "../../hooks/useMcpServer";

export function McpServerControl() {
  const { status, start, stop } = useMcpServer();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside =
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target);
      if (!inside) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const handleToggle = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (status.enabled) {
        await stop();
      } else {
        await start();
      }
    } finally {
      setLoading(false);
    }
  };

  const statusTone = status.running
    ? "bg-success"
    : status.enabled && status.error
      ? "bg-danger"
      : "bg-subtle";
  const statusText = status.running
    ? "Running"
    : status.enabled && status.error
      ? "Failed"
      : status.enabled
        ? "Starting"
        : "Off";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((prev) => !prev)}
        title="Local MCP Server"
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition active:scale-95 ${
          status.running
            ? "bg-success/10 text-success hover:bg-success/15"
            : "text-subtle hover:bg-surface-hover hover:text-fg"
        }`}
      >
        <Server className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-border-strong bg-surface p-3 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
            <span className="text-[12px] font-medium text-muted">Server</span>
            <button
              onClick={() => setOpen(false)}
              className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-fg"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusTone}`} />
              <div>
                <div className="text-[13px] font-medium text-fg">
                  Carrent Local Server
                </div>
                <div className="text-[11px] text-subtle">{statusText}</div>
              </div>
            </div>
            {status.running && <Check className="h-4 w-4 text-success" />}
          </div>

          <div className="mt-3 rounded-md bg-surface-raised px-2 py-1.5 text-[11px] text-subtle">
            {status.enabled
              ? "Skills can use Carrent's local MCP capabilities."
              : "Skills are disabled while this server is off."}
          </div>

          {status.url && (
            <div className="mt-3 break-all rounded-md bg-surface-raised px-2 py-1.5 text-[11px] text-subtle">
              {status.url}
            </div>
          )}

          {status.error && (
            <div className="mt-3 text-[11px] text-danger">{status.error}</div>
          )}

          <button
            onClick={handleToggle}
            disabled={loading}
            className={`mt-3 flex w-full items-center justify-center rounded-md px-3 py-1.5 text-[12px] font-medium transition active:scale-95 disabled:opacity-50 ${
              status.enabled
                ? "bg-surface-raised text-fg hover:bg-surface-hover"
                : "bg-fg text-bg hover:bg-fg/90"
            }`}
          >
            {loading ? "Working..." : status.enabled ? "Turn Off" : "Turn On"}
          </button>
        </div>
      )}
    </div>
  );
}
