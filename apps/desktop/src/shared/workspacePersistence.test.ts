import { describe, expect, it } from "bun:test";
import {
  WORKSPACE_SNAPSHOT_VERSION,
  normalizeWorkspaceSnapshot,
} from "./workspacePersistence";

describe("normalizeWorkspaceSnapshot", () => {
  it("accepts a valid current snapshot", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual(snapshot);
  });

  it("rejects malformed snapshots", () => {
    expect(normalizeWorkspaceSnapshot({ version: 999 })).toBeNull();
    expect(normalizeWorkspaceSnapshot(null)).toBeNull();
  });
});
