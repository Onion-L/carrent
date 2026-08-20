import { describe, expect, it } from "bun:test";

import { createAgentDebugStore } from "./agentDebugStore";

describe("createAgentDebugStore", () => {
  it("keeps ordered in-memory records per Thread and reports changes", () => {
    const changes: Array<{ threadId: string; revision: number }> = [];
    const store = createAgentDebugStore({ onChanged: (change) => changes.push(change) });

    store.append("thread-1", { runId: "run-1", type: "agent_start", raw: { type: "agent_start" } });
    store.append("thread-1", { runId: "run-1", type: "agent_end", raw: { type: "agent_end" } });

    expect(store.getTrace("thread-1")?.records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(changes).toEqual([
      { threadId: "thread-1", revision: 1 },
      { threadId: "thread-1", revision: 2 },
    ]);
  });

  it("bounds retained records without reusing sequence numbers", () => {
    const store = createAgentDebugStore({ maxRecordsPerThread: 2 });
    for (const type of ["one", "two", "three"]) {
      store.append("thread-1", { runId: "run-1", type, raw: { type } });
    }

    expect(store.getTrace("thread-1")).toMatchObject({
      truncated: true,
      records: [
        { sequence: 2, type: "two" },
        { sequence: 3, type: "three" },
      ],
    });
  });
});
