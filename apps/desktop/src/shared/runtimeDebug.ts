export type RuntimeDebugRequest = {
  threadId: string;
  runtimeId: "kimi";
};

export type RuntimeDebugRecord = {
  sequence: number;
  type: string;
  time?: number;
  raw: Record<string, unknown>;
};

export type RuntimeDebugTrace = {
  runtimeId: "kimi";
  sessionId: string;
  source: "kimi-wire";
  sourcePath: string;
  loadedAt: string;
  fileSize: number;
  modifiedAt: number;
  truncated: boolean;
  parseErrorCount: number;
  records: RuntimeDebugRecord[];
};
