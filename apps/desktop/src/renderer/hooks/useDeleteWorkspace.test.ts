import { describe, expect, it } from "bun:test";

import type { AppThreadRecord } from "../../shared/workspacePersistence";
import { getWorkspaceDeleteBlockedReason, isWorkspaceRoutePath } from "./useDeleteWorkspace";

function thread(workspaceId: string, id: string): AppThreadRecord {
  return { id, workspaceId } as AppThreadRecord;
}

describe("isWorkspaceRoutePath", () => {
  it("matches the Workspace overview and nested routes", () => {
    expect(isWorkspaceRoutePath("/workspace/abc", "abc")).toBe(true);
    expect(isWorkspaceRoutePath("/workspace/abc/project/p1", "abc")).toBe(true);
  });

  it("does not match a Workspace id that only shares a prefix", () => {
    expect(isWorkspaceRoutePath("/workspace/abc-def", "abc")).toBe(false);
    expect(isWorkspaceRoutePath("/workspace/abc-def/project/p1", "abc")).toBe(false);
  });

  it("does not match unrelated routes", () => {
    expect(isWorkspaceRoutePath("/settings", "abc")).toBe(false);
    expect(isWorkspaceRoutePath("/", "abc")).toBe(false);
  });
});

describe("getWorkspaceDeleteBlockedReason", () => {
  it("blocks deletion while one of the Workspace's Threads is running", () => {
    const threads = [thread("workspace-1", "thread-1"), thread("workspace-2", "thread-2")];

    expect(getWorkspaceDeleteBlockedReason(threads, ["thread-1"], "workspace-1")).toBe(
      "Stop the affected live Run before deleting",
    );
  });

  it("ignores runs that belong to other Workspaces", () => {
    const threads = [thread("workspace-2", "thread-2")];

    expect(getWorkspaceDeleteBlockedReason(threads, ["thread-2"], "workspace-1")).toBe(null);
    expect(getWorkspaceDeleteBlockedReason(threads, [], "workspace-1")).toBe(null);
  });
});
