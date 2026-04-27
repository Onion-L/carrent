import { describe, expect, it } from "bun:test";
import type { ProjectRecord, ThreadRecord } from "../mock/uiShellData";
import {
  archiveChatThread,
  archiveThreadInProjects,
  createChatThread,
  createProjectInProjects,
  createThreadInProjects,
  findCurrentProject,
  findCurrentThread,
  resolveChatThreadRouteData,
  toggleChatThreadPin,
  upsertChatThread,
  upsertThreadInProjects,
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
      makeProject({ id: "project-a", name: "Alpha" }, [makeThread({ id: "thread-a" })]),
      makeProject({ id: "project-b", name: "Beta" }, [makeThread({ id: "thread-b" })]),
    ];

    expect(findCurrentThread(projects, "thread-b")?.id).toBe("thread-b");
    expect(findCurrentProject(projects, "thread-b")?.id).toBe("project-b");
  });

  it("creates a new thread at the top of the target project", () => {
    const projects = [
      makeProject({ id: "project-a" }, [
        makeThread({ id: "thread-a", title: "Existing A" }),
        makeThread({ id: "thread-b", title: "Existing B" }),
      ]),
    ];

    const result = createThreadInProjects(projects, "project-a", "New thread");

    expect(result.thread?.title).toBe("New thread");
    expect(result.projects[0]?.threads[0]?.id).toBe(result.thread?.id);
    expect(result.projects[0]?.threads[0]?.title).toBe("New thread");
    expect(result.projects[0]?.threads).toHaveLength(3);
  });

  it("archives the active thread and returns the next visible thread id", () => {
    const projects = [
      makeProject({ id: "project-a" }, [
        makeThread({ id: "thread-a", title: "Pinned thread", pinned: true }),
        makeThread({ id: "thread-b", title: "Active thread" }),
      ]),
      makeProject({ id: "project-b" }, [
        makeThread({ id: "thread-c", title: "Other project thread" }),
      ]),
    ];

    const result = archiveThreadInProjects(projects, "project-a", "thread-b");

    expect(result.projects[0]?.threads.find((thread) => thread.id === "thread-b")?.archived).toBe(
      true,
    );
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

  it("upserts a promoted real thread into the target project", () => {
    const promotedThread = makeThread({
      id: "thread-real",
      title: "Promoted thread",
      updatedAt: "now",
    });
    const projects = [
      makeProject({ id: "project-a" }, [makeThread({ id: "thread-a", title: "Existing A" })]),
      makeProject({ id: "project-b" }, [makeThread({ id: "thread-b", title: "Existing B" })]),
    ];

    const result = upsertThreadInProjects(projects, "project-b", promotedThread);

    expect(result[0]).toBe(projects[0]);
    expect(result[1]?.threads[0]).toEqual(promotedThread);
    expect(result[1]?.threads).toHaveLength(2);
    expect(result[1]?.threads[1]?.id).toBe("thread-b");
  });

  it("merges promoted thread data into an existing thread without dropping local flags", () => {
    const originalThread = makeThread({
      id: "thread-real",
      title: "Old title",
      updatedAt: "1h",
      pinned: true,
      archived: true,
      active: true,
    });
    const promotedThread = makeThread({
      id: "thread-real",
      title: "New title",
      updatedAt: "now",
    });
    const projects = [
      makeProject({ id: "project-a" }, [
        originalThread,
        makeThread({ id: "thread-a", title: "Existing A" }),
      ]),
    ];

    const result = upsertThreadInProjects(projects, "project-a", promotedThread);

    expect(result[0]?.threads).toHaveLength(2);
    expect(result[0]?.threads[0]).toEqual({
      ...originalThread,
      ...promotedThread,
    });
    expect(result[0]?.threads.filter((thread) => thread.id === "thread-real")).toHaveLength(1);
  });

  it("leaves projects unchanged when the target project does not exist", () => {
    const projects = [
      makeProject({ id: "project-a" }, [makeThread({ id: "thread-a", pinned: true })]),
      makeProject({ id: "project-b" }, [makeThread({ id: "thread-b", archived: true })]),
    ];
    const promotedThread = makeThread({
      id: "thread-real",
      title: "Promoted thread",
      updatedAt: "now",
    });

    const result = upsertThreadInProjects(projects, "project-missing", promotedThread);

    expect(result).toEqual(projects);
    expect(result[0]).toBe(projects[0]);
    expect(result[1]).toBe(projects[1]);
  });

  it("creates a chat thread with trimmed title", () => {
    const thread = createChatThread("  Product vision  ");
    expect(thread?.title).toBe("Product vision");
  });

  it("rejects empty chat thread titles", () => {
    expect(createChatThread("   ")).toBe(null);
  });

  it("upserts a chat thread into existing chats", () => {
    const chats = [makeThread({ id: "chat-1", title: "First" })];
    const updated = upsertChatThread(chats, makeThread({ id: "chat-1", title: "Updated" }));
    expect(updated[0]?.title).toBe("Updated");
  });

  it("adds a new chat thread at the top when upserting", () => {
    const chats = [makeThread({ id: "chat-1", title: "First" })];
    const updated = upsertChatThread(chats, makeThread({ id: "chat-2", title: "Second" }));
    expect(updated).toHaveLength(2);
    expect(updated[0]?.id).toBe("chat-2");
  });

  it("toggles chat thread pin", () => {
    const chats = [makeThread({ id: "chat-1", pinned: false })];
    const updated = toggleChatThreadPin(chats, "chat-1");
    expect(updated[0]?.pinned).toBe(true);
  });

  it("archives a chat thread", () => {
    const chats = [makeThread({ id: "chat-1" })];
    const updated = archiveChatThread(chats, "chat-1");
    expect(updated[0]?.archived).toBe(true);
  });

  it("resolves chat route data for a thread id", () => {
    const chats = [makeThread({ id: "chat-1", title: "Chat One" })];
    const messages = [
      {
        id: "m1",
        threadId: "chat-1",
        role: "user" as const,
        content: "hi",
        agentId: "a1",
        timestamp: "09:00",
        type: "text" as const,
      },
      {
        id: "m2",
        threadId: "chat-2",
        role: "user" as const,
        content: "bye",
        agentId: "a1",
        timestamp: "09:01",
        type: "text" as const,
      },
    ];
    const routeData = resolveChatThreadRouteData(chats, messages, "chat-1");
    expect(routeData?.thread.id).toBe("chat-1");
    expect(routeData?.messages).toHaveLength(1);
    expect(routeData?.messages[0]?.threadId).toBe("chat-1");
  });

  it("returns null for missing chat route data", () => {
    const routeData = resolveChatThreadRouteData([], [], "missing");
    expect(routeData).toBe(null);
  });
});
