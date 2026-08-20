import type {
  AgentDebugChanged,
  AgentDebugRecord,
  AgentDebugTrace,
} from "../../src/shared/agentDebug";

type AgentDebugRecordInput = Omit<AgentDebugRecord, "sequence" | "time"> & { time?: number };

type ThreadDebugState = {
  nextSequence: number;
  revision: number;
  truncated: boolean;
  records: AgentDebugRecord[];
};

export type AgentDebugStore = ReturnType<typeof createAgentDebugStore>;

export function createAgentDebugStore(
  options: {
    maxRecordsPerThread?: number;
    onChanged?: (change: AgentDebugChanged) => void;
  } = {},
) {
  const maxRecordsPerThread = options.maxRecordsPerThread ?? 2_000;
  const states = new Map<string, ThreadDebugState>();

  function append(threadId: string, input: AgentDebugRecordInput) {
    const state = states.get(threadId) ?? {
      nextSequence: 1,
      revision: 0,
      truncated: false,
      records: [],
    };
    const record: AgentDebugRecord = {
      ...input,
      sequence: state.nextSequence++,
      time: input.time ?? Date.now(),
    };
    state.records.push(record);
    if (state.records.length > maxRecordsPerThread) {
      state.records.splice(0, state.records.length - maxRecordsPerThread);
      state.truncated = true;
    }
    state.revision += 1;
    states.set(threadId, state);
    options.onChanged?.({ threadId, revision: state.revision });
    return record;
  }

  function getTrace(threadId: string): AgentDebugTrace | null {
    const state = states.get(threadId);
    if (!state) return null;
    return {
      source: "agent-core",
      storage: "memory",
      loadedAt: new Date().toISOString(),
      truncated: state.truncated,
      records: state.records.map((record) => ({ ...record })),
    };
  }

  function deleteThreads(threadIds: string[]) {
    threadIds.forEach((threadId) => states.delete(threadId));
  }

  return { append, getTrace, deleteThreads };
}
