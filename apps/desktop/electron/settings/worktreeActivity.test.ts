import { describe, expect, it } from "bun:test";
import type { SharedChatRunStatus } from "../../src/shared/chat";
import type { AppThreadRecord } from "../../src/shared/workspacePersistence";
import { buildWorktreeActivitySnapshot } from "./worktreeActivity";

function thread(id: string, projectId: string): AppThreadRecord {
  return {
    id,
    workspaceId: "workspace-1",
    projectId,
    title: "Thread",
    createdAt: "2026-08-13T00:00:00.000Z",
    lastActivityAt: "2026-08-13T00:00:00.000Z",
    providerProfileId: "default",
    agentMode: "full-project",
  };
}

function run(threadId: string, status: SharedChatRunStatus) {
  return { threadId, status };
}

describe("buildWorktreeActivitySnapshot", () => {
  const liveStatuses: SharedChatRunStatus[] = [
    "starting",
    "running",
    "waiting-for-approval",
    "waiting-for-answer",
  ];
  const terminalStatuses: SharedChatRunStatus[] = ["completed", "failed", "cancelled"];

  it("treats starting, running, waiting-for-approval, and waiting-for-answer Runs as live", () => {
    for (const status of liveStatuses) {
      const snapshot = buildWorktreeActivitySnapshot({
        threads: [thread("thread-1", "project-1")],
        runs: [run("thread-1", status)],
        runningTerminalTabs: [],
      });
      expect(snapshot.liveRunProjectIds).toEqual(["project-1"]);
    }
  });

  it("ignores completed, failed, and cancelled Runs", () => {
    for (const status of terminalStatuses) {
      const snapshot = buildWorktreeActivitySnapshot({
        threads: [thread("thread-1", "project-1")],
        runs: [run("thread-1", status)],
        runningTerminalTabs: [],
      });
      expect(snapshot.liveRunProjectIds).toEqual([]);
    }
  });

  it("deduplicates Project IDs when several live Runs share a Project", () => {
    const snapshot = buildWorktreeActivitySnapshot({
      threads: [thread("thread-1", "project-1"), thread("thread-2", "project-1")],
      runs: [run("thread-1", "running"), run("thread-2", "waiting-for-answer")],
      runningTerminalTabs: [],
    });
    expect(snapshot.liveRunProjectIds).toEqual(["project-1"]);
  });

  it("ignores Runs whose Thread has no Project record", () => {
    const snapshot = buildWorktreeActivitySnapshot({
      threads: [],
      runs: [run("thread-1", "running")],
      runningTerminalTabs: [],
    });
    expect(snapshot.liveRunProjectIds).toEqual([]);
  });

  it("passes running Terminal Tabs through unchanged", () => {
    const tabs = [{ projectId: "project-1", workingDirectory: "/code/carrent/feat-wt" }];
    const snapshot = buildWorktreeActivitySnapshot({
      threads: [],
      runs: [],
      runningTerminalTabs: tabs,
    });
    expect(snapshot.runningTerminalTabs).toBe(tabs);
  });
});
