import type { McpServerStatus } from "../../src/shared/mcpServer";
import type { CarrentBridgeManager } from "./carrentBridgeManager";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export function registerMcpServerIpc(
  ipcMainLike: IpcMainLike,
  manager: CarrentBridgeManager,
) {
  ipcMainLike.handle("mcp-server:start", async () => {
    return manager.start() as Promise<McpServerStatus>;
  });

  ipcMainLike.handle("mcp-server:stop", async () => {
    return manager.stop() as Promise<McpServerStatus>;
  });

  ipcMainLike.handle("mcp-server:status", async () => {
    return manager.getStatus() as McpServerStatus;
  });
}
