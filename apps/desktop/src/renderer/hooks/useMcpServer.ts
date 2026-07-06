import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeMcpServerStatus, type McpServerStatus } from "../../shared/mcpServer";

const MCP_SERVER_STATUS_EVENT = "carrent:mcp-server-status";
const DEFAULT_MCP_SERVER_STATUS: McpServerStatus = { enabled: true, running: false };

export function publishMcpServerStatus(status: McpServerStatus) {
  window.dispatchEvent(
    new CustomEvent<McpServerStatus>(MCP_SERVER_STATUS_EVENT, { detail: status }),
  );
}

export function useMcpServer() {
  const [status, setStatus] = useState<McpServerStatus>(DEFAULT_MCP_SERVER_STATUS);
  const latestStatusRef = useRef(status);

  const updateStatus = useCallback((nextStatus: unknown) => {
    const normalizedStatus = normalizeMcpServerStatus(nextStatus);
    latestStatusRef.current = normalizedStatus;
    setStatus(normalizedStatus);
    publishMcpServerStatus(normalizedStatus);
  }, []);

  const updateError = useCallback(
    (error: unknown) => {
      updateStatus({
        ...latestStatusRef.current,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    [updateStatus],
  );

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await window.carrent.mcpServer.getStatus();
      updateStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      updateError(error);
      return latestStatusRef.current;
    }
  }, [updateError, updateStatus]);

  const start = useCallback(async () => {
    try {
      const nextStatus = await window.carrent.mcpServer.start();
      updateStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      updateError(error);
      return latestStatusRef.current;
    }
  }, [updateError, updateStatus]);

  const stop = useCallback(async () => {
    try {
      const nextStatus = await window.carrent.mcpServer.stop();
      updateStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      updateError(error);
      return latestStatusRef.current;
    }
  }, [updateError, updateStatus]);

  useEffect(() => {
    latestStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    void refresh();

    const handleStatusUpdate = (event: Event) => {
      const nextStatus = normalizeMcpServerStatus((event as CustomEvent<unknown>).detail);
      latestStatusRef.current = nextStatus;
      setStatus(nextStatus);
    };

    window.addEventListener(MCP_SERVER_STATUS_EVENT, handleStatusUpdate);
    return () => window.removeEventListener(MCP_SERVER_STATUS_EVENT, handleStatusUpdate);
  }, [refresh]);

  return { status, refresh, start, stop };
}
