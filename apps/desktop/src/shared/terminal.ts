export const MAX_TERMINAL_INPUT_BYTES = 64 * 1024;
export const MAX_TERMINAL_TITLE_LENGTH = 160;
export const MIN_TERMINAL_PANEL_HEIGHT = 180;
export const MAX_TERMINAL_PANEL_HEIGHT = 720;

export type TerminalTabStatus = "running" | "exited";

export type TerminalTab = {
  id: string;
  projectId: string;
  title: string;
  active: boolean;
  status: TerminalTabStatus;
  enhancedCompletion: boolean;
};

export type CreateTerminalRequest = {
  projectId: string;
  projectName: string;
  workingDirectory: string;
  enhancedCompletion: boolean;
};

export type TerminalTarget = {
  projectId: string;
  terminalId: string;
};

export type TerminalWriteRequest = TerminalTarget & { data: string };
export type TerminalResizeRequest = TerminalTarget & { columns: number; rows: number };

export type TerminalCandidate = {
  label: string;
  insertText: string;
  description?: string;
  kind:
    | "executable"
    | "builtin"
    | "alias"
    | "function"
    | "file"
    | "directory"
    | "command"
    | "option"
    | "script";
  replacement: { start: number; end: number };
};

export type TerminalEvent =
  | (TerminalTarget & { type: "output"; data: string })
  | (TerminalTarget & { type: "title"; title: string })
  | (TerminalTarget & { type: "exit"; exitCode: number; signal?: number })
  | (TerminalTarget & {
      type: "completion";
      commandLine: string;
      cursor: number;
      predictionSuffix: string;
      candidates: TerminalCandidate[];
    });

export type TerminalApi = {
  list: (projectId: string) => Promise<TerminalTab[]>;
  create: (request: CreateTerminalRequest) => Promise<TerminalTab>;
  write: (request: TerminalWriteRequest) => Promise<void>;
  resize: (request: TerminalResizeRequest) => Promise<void>;
  activate: (target: TerminalTarget) => Promise<void>;
  close: (target: TerminalTarget) => Promise<void>;
  closeProject: (projectId: string) => Promise<void>;
  onEvent: (listener: (event: TerminalEvent) => void) => VoidFunction;
};
