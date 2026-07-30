import { describe, expect, it } from "bun:test";

import type {
  AppProjectRecord,
  AppThreadRecord,
  WorkspaceProjectAssociationRecord,
  WorkspaceRecord,
} from "../../shared/workspacePersistence";
import { searchThreads } from "./threadSearch";

const workspaces: WorkspaceRecord[] = [
  { id: "workspace-1", name: "Personal", order: 0 },
  { id: "workspace-2", name: "Client", order: 1 },
];
const projects: AppProjectRecord[] = [
  { id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" },
  { id: "project-2", name: "Website", workingDirectory: "/code/website" },
];
const associations: WorkspaceProjectAssociationRecord[] = [
  {
    workspaceId: "workspace-1",
    projectId: "project-1",
    alias: "Personal Carrent",
    order: 0,
    defaultRuntimeId: "kimi",
    defaultRuntimeMode: "approval-required",
  },
  {
    workspaceId: "workspace-1",
    projectId: "project-2",
    order: 1,
    defaultRuntimeId: "kimi",
    defaultRuntimeMode: "approval-required",
  },
  {
    workspaceId: "workspace-2",
    projectId: "project-1",
    alias: "Client Carrent",
    order: 0,
    defaultRuntimeId: "kimi",
    defaultRuntimeMode: "approval-required",
  },
];

function makeThread(
  id: string,
  title: string,
  workspaceId: string,
  projectId: string,
  lastActivityAt: string,
  archived = false,
): AppThreadRecord {
  return {
    id,
    title,
    workspaceId,
    projectId,
    createdAt: lastActivityAt,
    lastActivityAt,
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
    ...(archived ? { archived: true } : {}),
  };
}

describe("searchThreads", () => {
  it("returns active Threads across all Workspaces and Projects without scoping", () => {
    const threads = [
      makeThread("personal-carrent", "Personal Carrent", "workspace-1", "project-1", "2026-01-01"),
      makeThread("personal-site", "Personal Website", "workspace-1", "project-2", "2026-01-02"),
      makeThread("client-carrent", "Client Carrent", "workspace-2", "project-1", "2026-01-03"),
      makeThread("archived", "Archived Carrent", "workspace-1", "project-1", "2026-01-04", true),
    ];

    const input = { threads, workspaces, projects, associations };
    expect(searchThreads({ ...input, query: "" }).map((entry) => entry.thread.id)).toEqual([
      "client-carrent",
      "personal-site",
      "personal-carrent",
    ]);
    expect(searchThreads({ ...input, query: "carrent" }).map((entry) => entry.thread.id)).toEqual([
      "client-carrent",
      "personal-carrent",
    ]);
  });

  it("ranks trimmed case-insensitive exact, prefix, and substring title matches", () => {
    const threads = [
      makeThread("substring", "Fix Search Panel", "workspace-1", "project-1", "2026-05-03"),
      makeThread("prefix-old", "Search Keyboard", "workspace-1", "project-1", "2026-05-01"),
      makeThread("exact", "SEARCH", "workspace-2", "project-1", "2026-01-01"),
      makeThread("prefix-new", "Search Scope", "workspace-1", "project-2", "2026-05-02"),
      makeThread("miss", "Navigation", "workspace-1", "project-1", "2026-06-01"),
    ];

    expect(
      searchThreads({
        threads,
        workspaces,
        projects,
        associations,
        query: "  search  ",
      }).map((entry) => entry.thread.id),
    ).toEqual(["exact", "prefix-new", "prefix-old", "substring"]);
  });

  it("returns at most 20 recent Threads for an empty query and every match otherwise", () => {
    const threads = Array.from({ length: 25 }, (_, index) =>
      makeThread(
        `thread-${index}`,
        `Matching Thread ${index}`,
        "workspace-1",
        "project-1",
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      ),
    );
    const input = { threads, workspaces, projects, associations };

    expect(searchThreads({ ...input, query: "" })).toHaveLength(20);
    expect(searchThreads({ ...input, query: "matching" })).toHaveLength(25);
  });
});
