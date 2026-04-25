import { describe, expect, it } from "bun:test";
import type { ProjectRecord, ThreadRecord } from "../mock/uiShellData";
import {
  archiveThreadInProjects,
  createProjectInProjects,
  createThreadInProjects,
  findCurrentProject,
  findCurrentThread,
} from "./workspaceState";

function makeThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "thread-1",
    title: "Thread",
    updatedAt: "1h",
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<ProjectRecord> = {},
  threads: ThreadRecord[] = [],
): ProjectRecord {
  return {
    id: "project-1",
    name: "Project",
    path: "/tmp/project",
    threads,
    ...overrides,
  };
}

describe("workspaceState", () => {
  it("finds the current thread and project from activeThreadId", () => {
    const projects = [
      makeProject(
        { id: "project-a", name: "Alpha" },
        [makeThread({ id: "thread-a" })],
      ),
      makeProject(
        { id: "project-b", name: "Beta" },
        [makeThread({ id: "thread-b" })],
      ),
    ];

    expect(findCurrentThread(projects, "thread-b")?.id).toBe("thread-b");
    expect(findCurrentProject(projects, "thread-b")?.id).toBe("project-b");
  });

  it("creates a new thread at the top of the target project", () => {
    const projects = [
      makeProject(
        { id: "project-a" },
        [
          makeThread({ id: "thread-a", title: "Existing A" }),
          makeThread({ id: "thread-b", title: "Existing B" }),
        ],
      ),
    ];

    const result = createThreadInProjects(projects, "project-a", "New thread");

    expect(result.thread?.title).toBe("New thread");
    expect(result.projects[0]?.threads[0]?.id).toBe(result.thread?.id);
    expect(result.projects[0]?.threads[0]?.title).toBe("New thread");
    expect(result.projects[0]?.threads).toHaveLength(3);
  });

  it("archives the active thread and returns the next visible thread id", () => {
    const projects = [
      makeProject(
        { id: "project-a" },
        [
          makeThread({ id: "thread-a", title: "Pinned thread", pinned: true }),
          makeThread({ id: "thread-b", title: "Active thread" }),
        ],
      ),
      makeProject(
        { id: "project-b" },
        [makeThread({ id: "thread-c", title: "Other project thread" })],
      ),
    ];

    const result = archiveThreadInProjects(projects, "project-a", "thread-b");

    expect(
      result.projects[0]?.threads.find((thread) => thread.id === "thread-b")
        ?.archived,
    ).toBe(true);
    expect(result.nextActiveThreadId).toBe("thread-a");
  });

  it("creates a project from a folder path", () => {
    const projects = [makeProject({ id: "project-a" })];
    const result = createProjectInProjects(projects, "/Users/onion/workbench/new-app");

    expect(result.projects).toHaveLength(2);
    expect(result.project).toBeDefined();
    expect(result.project?.path).toBe("/Users/onion/workbench/new-app");
    expect(result.project?.threads).toHaveLength(0);
  });

  it("uses the folder basename as the project name", () => {
    const result = createProjectInProjects([], "/Users/onion/workbench/my-project");
    expect(result.project?.name).toBe("my-project");
  });
});
