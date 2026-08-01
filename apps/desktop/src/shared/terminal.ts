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
  ensureFirst?: boolean;
};

export type TerminalTarget = {
  projectId: string;
  terminalId: string;
};

export type TerminalWriteRequest = TerminalTarget & { data: string };
export type TerminalResizeRequest = TerminalTarget & {
  columns: number;
  rows: number;
  focusVersion: number;
};
export type TerminalFocusRequest = TerminalResizeRequest & { focused: boolean };

export type TerminalProjectSnapshot = {
  projectId: string;
  revision: number;
  tabs: TerminalTab[];
  outputByTerminal: Record<string, string>;
};

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
  | (TerminalTarget & { type: "output"; revision: number; data: string })
  | (TerminalTarget & { type: "title"; revision: number; title: string })
  | (TerminalTarget & { type: "exit"; revision: number; exitCode: number; signal?: number })
  | (TerminalTarget & {
      type: "completion";
      revision: number;
      commandLine: string;
      cursor: number;
      predictionSuffix: string;
      candidates: TerminalCandidate[];
    })
  | {
      type: "state";
      projectId: string;
      revision: number;
      tabs: TerminalTab[];
    };

export type TerminalApi = {
  subscribe: (projectId: string) => Promise<TerminalProjectSnapshot>;
  unsubscribe: (projectId: string) => Promise<void>;
  create: (request: CreateTerminalRequest) => Promise<TerminalTab>;
  write: (request: TerminalWriteRequest) => Promise<void>;
  resize: (request: TerminalResizeRequest) => Promise<void>;
  focus: (request: TerminalFocusRequest) => Promise<void>;
  activate: (target: TerminalTarget) => Promise<void>;
  close: (target: TerminalTarget) => Promise<void>;
  closeProject: (projectId: string) => Promise<void>;
  onEvent: (listener: (event: TerminalEvent) => void) => VoidFunction;
};
