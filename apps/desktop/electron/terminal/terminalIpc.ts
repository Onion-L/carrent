import type {
  CreateTerminalRequest,
  TerminalResizeRequest,
  TerminalTarget,
  TerminalWriteRequest,
} from "../../src/shared/terminal";
import type { TerminalSessionManager } from "./terminalSessionManager";

type IpcEvent = { sender: { id: number } };

type IpcMainLike = {
  handle: (
    channel: string,
    listener: (event: unknown, input?: unknown) => Promise<unknown> | unknown,
  ) => void;
};

type TerminalIpcManager = Pick<
  TerminalSessionManager,
  "list" | "create" | "write" | "resize" | "activate" | "close" | "closeProject"
>;

function ownerId(event: unknown) {
  const id = (event as Partial<IpcEvent>)?.sender?.id;
  if (!Number.isInteger(id)) throw new Error("Unexpected Renderer owner.");
  return id as number;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid terminal request.");
  }
  return input as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Invalid terminal ${key}.`);
  return value;
}

function target(input: unknown): TerminalTarget {
  const value = record(input);
  return {
    projectId: stringField(value, "projectId"),
    terminalId: stringField(value, "terminalId"),
  };
}

export function registerTerminalIpc(ipcMain: IpcMainLike, manager: TerminalIpcManager) {
  ipcMain.handle("terminal:list", (event, input) => {
    if (typeof input !== "string") throw new Error("Invalid Project identity.");
    return manager.list(ownerId(event), input);
  });
  ipcMain.handle("terminal:create", (event, input) => {
    const value = record(input);
    const request: CreateTerminalRequest = {
      projectId: stringField(value, "projectId"),
      projectName: stringField(value, "projectName"),
      workingDirectory: stringField(value, "workingDirectory"),
      enhancedCompletion: value.enhancedCompletion === true,
    };
    return manager.create({ ...request, ownerId: ownerId(event) });
  });
  ipcMain.handle("terminal:write", (event, input) => {
    const value = record(input);
    const request: TerminalWriteRequest = { ...target(value), data: stringField(value, "data") };
    manager.write(ownerId(event), request.projectId, request.terminalId, request.data);
  });
  ipcMain.handle("terminal:resize", (event, input) => {
    const value = record(input);
    const request: TerminalResizeRequest = {
      ...target(value),
      columns: value.columns as number,
      rows: value.rows as number,
    };
    manager.resize(
      ownerId(event),
      request.projectId,
      request.terminalId,
      request.columns,
      request.rows,
    );
  });
  ipcMain.handle("terminal:activate", (event, input) => {
    const request = target(input);
    manager.activate(ownerId(event), request.projectId, request.terminalId);
  });
  ipcMain.handle("terminal:close", (event, input) => {
    const request = target(input);
    manager.close(ownerId(event), request.projectId, request.terminalId);
  });
  ipcMain.handle("terminal:close-project", (_event, input) => {
    if (typeof input !== "string") throw new Error("Invalid Project identity.");
    manager.closeProject(input);
  });
}
