import { useState } from "react";

import { useMcpServer } from "../../hooks/useMcpServer";

export function McpServerControl() {
  const { status, start, stop } = useMcpServer();
  const [loading, setLoading] = useState(false);

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

  const statusText = status.running
    ? "Running"
    : status.enabled && status.error
      ? "Failed"
      : status.enabled
        ? "Starting"
        : "Off";

  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-app-13 text-fg">Carrent Local Server</div>
          <div className="mt-0.5 text-app-12 text-subtle">
            {statusText}.{" "}
            {status.enabled
              ? "Skills can use Carrent's local MCP capabilities."
              : "Skills are disabled while this server is off."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.enabled}
          aria-label="Local MCP Server"
          title={status.enabled ? "Turn Off" : "Turn On"}
          disabled={loading}
          onClick={() => void handleToggle()}
          className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-50 ${
            status.enabled ? "bg-fg" : "bg-surface-hover"
          }`}
        >
          <span
            className={`absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-bg transition-transform ${
              status.enabled ? "translate-x-[12px]" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {status.error ? <div className="mt-2 text-app-12 text-danger">{status.error}</div> : null}
    </div>
  );
}
