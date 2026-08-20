export type AgentDebugRequest = {
  threadId: string;
};

export type AgentDebugRecord = {
  sequence: number;
  runId: string;
  type: string;
  time: number;
  raw: Record<string, unknown>;
};

export type AgentDebugTrace = {
  source: "agent-core";
  storage: "memory";
  loadedAt: string;
  truncated: boolean;
  records: AgentDebugRecord[];
};

export type AgentDebugChanged = {
  threadId: string;
  revision: number;
};
