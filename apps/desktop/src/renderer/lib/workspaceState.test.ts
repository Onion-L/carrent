import { describe, expect, it } from "bun:test";
import { DEFAULT_RUNTIME_ID } from "../../shared/runtimes";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
import type { ProjectRecord, ThreadRecord } from "../mock/uiShellData";
import {
  createChatThread,
  deleteChatThread,
  deleteThreadInProjects,
  createProjectInProjects,
  createThreadInProjects,
  findCurrentProject,
  findCurrentThread,
  findProjectIdForThread,
  markThreadActivityInProjects,
  renameThreadInProjects,
  resolveChatThreadRouteData,
  setChatThreadRuntimeId,
  setChatThreadRuntimeMode,
  setChatThreadRuntimeModelId,
  setChatThreadPlanMode,
  setThreadPlanModeInProjects,
  setThreadRuntimeIdInProjects,
  setThreadRuntimeModeInProjects,
  setThreadRuntimeModelIdInProjects,
  toggleChatThreadPin,
  upsertChatThread,
  upsertThreadInProjects,
} from "./workspaceState";
import { splitProjectThreads } from "./projectThreads";

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

  it("finds the owning project for a thread", () => {
    const projects = [
      makeProject({ id: "project-a" }, [makeThread({ id: "thread-a" })]),
      makeProject({ id: "project-b" }, [makeThread({ id: "thread-b" })]),
    ];

    expect(findProjectIdForThread(projects, "thread-b")).toBe("project-b");
    expect(findProjectIdForThread(projects, "thread-a")).toBe("project-a");
  });

  it("renames a thread without changing its activity time", () => {
    const thread = makeThread({
      id: "thread-a",
      title: "Old title",
      lastActivityAt: "2026-01-01T00:00:00Z",
    });
    const result = renameThreadInProjects(
      [makeProject({ id: "project-a" }, [thread])],
      "project-a",
      "thread-a",
      "  New title  ",
    );

    expect(result.renamed).toBe(true);
    expect(result.projects[0].threads[0]).toEqual({ ...thread, title: "New title" });
  });

  it("rejects an empty thread title", () => {
    const projects = [makeProject({ id: "project-a" }, [makeThread({ id: "thread-a" })])];
    expect(renameThreadInProjects(projects, "project-a", "thread-a", "  ")).toEqual({
      projects,
      renamed: false,
    });
  });

  it("marks thread activity without reordering project threads", () => {
    const projects = [
      makeProject({ id: "project-a" }, [
        makeThread({ id: "thread-a" }),
        makeThread({ id: "thread-b" }),
      ]),
    ];
    const result = markThreadActivityInProjects(projects, "thread-b", "2026-05-01T00:00:00Z");

    expect(result[0].threads.map((thread) => thread.id)).toEqual(["thread-a", "thread-b"]);
    expect(result[0].threads[1].lastActivityAt).toBe("2026-05-01T00:00:00Z");
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

  it("creates a new thread with a runtime model id", () => {
    const result = createThreadInProjects(
      [makeProject({ id: "project-a" }, [])],
      "project-a",
      "New thread",
      "codex",
      "gpt-5",
    );

    expect(result.thread?.runtimeModelId).toBe("gpt-5");
  });

  it("deletes the active thread and returns the next visible thread id", () => {
    const projects = [
      makeProject({ id: "project-a" }, [
        makeThread({ id: "thread-a", title: "Pinned thread", pinned: true }),
        makeThread({ id: "thread-b", title: "Active thread" }),
      ]),
      makeProject({ id: "project-b" }, [
        makeThread({ id: "thread-c", title: "Other project thread" }),
      ]),
    ];

    const result = deleteThreadInProjects(projects, "project-a", "thread-b");

    expect(result.projects[0]?.threads.some((thread) => thread.id === "thread-b")).toBe(false);
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
      makeProject({ id: "project-b" }, [makeThread({ id: "thread-b" })]),
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

  it("creates a chat thread with a runtime model id", () => {
    expect(createChatThread("Ideas", "pi", "gpt-5")?.runtimeModelId).toBe("gpt-5");
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

  it("deletes a chat thread", () => {
    const chats = [makeThread({ id: "chat-1" }), makeThread({ id: "chat-2" })];
    const updated = deleteChatThread(chats, "chat-1");
    expect(updated.some((thread) => thread.id === "chat-1")).toBe(false);
    expect(updated.some((thread) => thread.id === "chat-2")).toBe(true);
  });

  it("resolves chat route data for a thread id", () => {
    const chats = [makeThread({ id: "chat-1", title: "Chat One" })];
    const messages = [
      {
        id: "m1",
        threadId: "chat-1",
        role: "user" as const,
        content: "hi",
        timestamp: "09:00",
        type: "text" as const,
      },
      {
        id: "m2",
        threadId: "chat-2",
        role: "user" as const,
        content: "bye",
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

  it("creates project threads with the safe runtime mode", () => {
    const result = createThreadInProjects([makeProject({ id: "p1" }, [])], "p1", "New");
    expect(result.thread?.runtimeMode).toBe(DEFAULT_RUNTIME_MODE);
  });

  it("creates project threads with Plan mode disabled", () => {
    const result = createThreadInProjects([makeProject({ id: "p1" }, [])], "p1", "New");
    expect(result.thread?.planMode).toBe(false);
  });

  it("creates project threads with the default runtime", () => {
    const result = createThreadInProjects([makeProject({ id: "p1" }, [])], "p1", "New");
    expect(result.thread?.runtimeId).toBe(DEFAULT_RUNTIME_ID);
  });

  it("creates project threads with a provided runtime", () => {
    const result = createThreadInProjects(
      [makeProject({ id: "p1" }, [])],
      "p1",
      "New",
      "claude-code",
    );
    expect(result.thread?.runtimeId).toBe("claude-code");
  });

  it("creates chat threads with the safe runtime mode", () => {
    expect(createChatThread("Ideas")?.runtimeMode).toBe(DEFAULT_RUNTIME_MODE);
  });

  it("creates chat threads with Plan mode disabled", () => {
    expect(createChatThread("Ideas")?.planMode).toBe(false);
  });

  it("creates chat threads with the default runtime", () => {
    expect(createChatThread("Ideas")?.runtimeId).toBe(DEFAULT_RUNTIME_ID);
  });

  it("creates chat threads with a provided runtime", () => {
    expect(createChatThread("Ideas", "pi")?.runtimeId).toBe("pi");
  });

  it("sets runtime mode on a project thread", () => {
    const projects = [makeProject({ id: "p1" }, [makeThread({ id: "t1" })])];
    const updated = setThreadRuntimeModeInProjects(projects, "p1", "t1", "auto-accept-edits");
    expect(updated[0].threads[0].runtimeMode).toBe("auto-accept-edits");
  });

  it("sets Plan mode on a project thread", () => {
    const projects = [makeProject({ id: "p1" }, [makeThread({ id: "t1", planMode: false })])];
    const updated = setThreadPlanModeInProjects(projects, "p1", "t1", true);
    expect(updated[0].threads[0].planMode).toBe(true);
  });

  it("sets runtime on a project thread", () => {
    const projects = [makeProject({ id: "p1" }, [makeThread({ id: "t1" })])];
    const updated = setThreadRuntimeIdInProjects(projects, "p1", "t1", "claude-code");
    expect(updated[0].threads[0].runtimeId).toBe("claude-code");
  });

  it("sets runtime model id on a project thread", () => {
    const projects = [makeProject({ id: "p1" }, [makeThread({ id: "t1" })])];
    const updated = setThreadRuntimeModelIdInProjects(projects, "p1", "t1", "gpt-5");
    expect(updated[0].threads[0].runtimeModelId).toBe("gpt-5");
  });

  it("sets runtime mode on a chat thread", () => {
    const updated = setChatThreadRuntimeMode([makeThread({ id: "c1" })], "c1", "full-access");
    expect(updated[0].runtimeMode).toBe("full-access");
  });

  it("sets Plan mode on a chat thread", () => {
    const updated = setChatThreadPlanMode([makeThread({ id: "c1", planMode: false })], "c1", true);
    expect(updated[0].planMode).toBe(true);
  });

  it("sets runtime on a chat thread", () => {
    const updated = setChatThreadRuntimeId([makeThread({ id: "c1" })], "c1", "claude-code");
    expect(updated[0].runtimeId).toBe("claude-code");
  });

  it("sets runtime model id on a chat thread", () => {
    const updated = setChatThreadRuntimeModelId([makeThread({ id: "c1" })], "c1", "gpt-5");
    expect(updated[0].runtimeModelId).toBe("gpt-5");
  });

  it("creates a draft thread when draft is true", () => {
    const result = createThreadInProjects(
      [makeProject({ id: "p1" }, [])],
      "p1",
      "Draft",
      undefined,
      undefined,
      true,
    );
    expect(result.thread?.draft).toBe(true);
    expect(result.projects[0]?.threads[0]?.draft).toBe(true);
  });

  it("creates a non-draft thread by default", () => {
    const result = createThreadInProjects([makeProject({ id: "p1" }, [])], "p1", "Not draft");
    expect(result.thread?.draft).toBeUndefined();
  });

  it("excludes draft threads from split project threads", () => {
    const threads = [
      makeThread({ id: "draft-thread", draft: true }),
      makeThread({ id: "visible-thread" }),
    ];
    const split = splitProjectThreads(threads);
    expect(split.active).toHaveLength(1);
    expect(split.active[0]?.id).toBe("visible-thread");
  });
});
