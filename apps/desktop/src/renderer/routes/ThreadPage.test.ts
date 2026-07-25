import { describe, expect, it } from "bun:test";

import { resolveWorkspaceThreadRouteData } from "../context/WorkspaceContext";
import {
  messages as seededMessages,
  projects as seededProjects,
  type Message,
  type ProjectRecord,
  type SubagentTaskPart,
  type ThreadRecord,
} from "../mock/uiShellData";
import {
  collectSubagentTasks,
  resolveRightPane,
  shouldShowInspectorToggle,
  updateSeenSubagentTasks,
} from "../components/chat/ThreadInspectorPane";
import { getThreadInspectorInput, resolveThreadRouteData } from "./ThreadPage";

type TextMessage = {
  id: string;
  role: "user";
  timestamp: string;
  threadId: string;
  content: string;
  type?: "text";
  duration?: string;
};

function makeThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "thread-1",
    title: "Thread 1",
    updatedAt: "now",
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<ProjectRecord> = {},
  threads: ThreadRecord[] = [],
): ProjectRecord {
  return {
    id: "project-1",
    name: "Project 1",
    path: "/tmp/project-1",
    threads,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<TextMessage> = {}): TextMessage {
  return {
    id: "message-1",
    role: "user",
    timestamp: "09:00",
    threadId: "thread-1",
    content: "hello",
    ...overrides,
  };
}

describe("resolveThreadRouteData", () => {
  it("returns the matching project, thread, and messages", () => {
    const projects = [
      makeProject({ id: "project-1" }, [
        makeThread({ id: "thread-1" }),
        makeThread({ id: "thread-2" }),
      ]),
    ];
    const messages: Message[] = [
      makeMessage({ id: "message-1", threadId: "thread-1" }),
      makeMessage({ id: "message-2", threadId: "thread-2" }),
    ];

    const result = resolveThreadRouteData(
      (projectId, threadId) =>
        resolveWorkspaceThreadRouteData(projects, messages, projectId, threadId),
      "project-1",
      "thread-1",
    );

    expect(result?.project.id).toBe("project-1");
    expect(result?.thread.id).toBe("thread-1");
    expect(result?.messages.map((message) => message.id)).toEqual(["message-1"]);
  });

  it("returns null when the thread does not belong to the project", () => {
    const projects = [
      makeProject({ id: "project-1" }, [makeThread({ id: "thread-1" })]),
      makeProject({ id: "project-2" }, [makeThread({ id: "thread-2" })]),
    ];

    expect(
      resolveThreadRouteData(
        (projectId, threadId) => resolveWorkspaceThreadRouteData(projects, [], projectId, threadId),
        "project-1",
        "thread-2",
      ),
    ).toBe(null);
  });

  it("reads the verification route directly from seeded workspace data", () => {
    const result = resolveThreadRouteData(
      (projectId, threadId) =>
        resolveWorkspaceThreadRouteData(seededProjects, seededMessages, projectId, threadId),
      "project-1",
      "thread-1",
    );

    expect(result?.project.id).toBe("project-1");
    expect(result?.thread.id).toBe("thread-1");
    expect(result?.thread.title).toBe("Shared workspace thread state");
    expect(result?.messages.map((message) => message.id)).toEqual([
      "message-carrent-1",
      "message-carrent-2",
    ]);
  });
});

function makeSubagentTask(overrides: Partial<SubagentTaskPart> = {}): SubagentTaskPart {
  return {
    type: "subagent_task",
    id: "task-1",
    runtimeId: "kimi",
    source: "agent",
    description: "Implement persistence",
    background: false,
    status: "running",
    startedAt: 1_000,
    ...overrides,
  };
}

describe("thread inspector integration", () => {
  it("passes the project path and messages to the inspector", () => {
    const projects = [
      makeProject({ id: "project-1", path: "/tmp/project-1" }, [makeThread({ id: "thread-1" })]),
    ];
    const taskMessage = {
      id: "message-task",
      role: "assistant",
      threadId: "thread-1",
      timestamp: "09:00",
      content: "",
      parts: [makeSubagentTask({ id: "task-1" })],
    } as Message;

    const routeData = resolveThreadRouteData(
      (projectId, threadId) =>
        resolveWorkspaceThreadRouteData(projects, [taskMessage], projectId, threadId),
      "project-1",
      "thread-1",
    );
    const input = getThreadInspectorInput(routeData);

    expect(input?.projectPath).toBe("/tmp/project-1");
    expect(collectSubagentTasks(input?.messages ?? []).map((task) => task.id)).toEqual(["task-1"]);
  });

  it("returns null inspector input for a missing thread", () => {
    expect(getThreadInspectorInput(null)).toBe(null);
  });

  it("opens the inspector only for newly seen running task ids", () => {
    const running = makeSubagentTask({ id: "task-1", status: "running" });

    const first = updateSeenSubagentTasks({ tasks: [running], seenTaskIds: new Set() });
    expect(first.shouldOpen).toBe(true);
    expect(first.seenTaskIds.has("task-1")).toBe(true);

    // Updates to an already-seen task never reopen a user-closed pane.
    const second = updateSeenSubagentTasks({
      tasks: [{ ...running, status: "completed" }],
      seenTaskIds: first.seenTaskIds,
    });
    expect(second.shouldOpen).toBe(false);

    // A later new running task may open it again.
    const third = updateSeenSubagentTasks({
      tasks: [{ ...running, id: "task-2" }],
      seenTaskIds: second.seenTaskIds,
    });
    expect(third.shouldOpen).toBe(true);
  });

  it("treats a Thread reset as a fresh seen set", () => {
    const running = makeSubagentTask({ id: "task-1", status: "running" });

    const afterReset = updateSeenSubagentTasks({ tasks: [running], seenTaskIds: new Set() });
    expect(afterReset.shouldOpen).toBe(true);
    expect([...afterReset.seenTaskIds]).toEqual(["task-1"]);
  });

  it("gives the Diff view precedence and restores the inspector when it closes", () => {
    expect(resolveRightPane({ diffOpen: true, inspectorOpen: true })).toBe("diff");
    expect(resolveRightPane({ diffOpen: false, inspectorOpen: true })).toBe("inspector");
    expect(resolveRightPane({ diffOpen: false, inspectorOpen: false })).toBe(null);
  });

  it("shows the toggle for project Threads even without tasks", () => {
    expect(shouldShowInspectorToggle({ hasProjectEnvironment: true, taskCount: 0 })).toBe(true);
    expect(shouldShowInspectorToggle({ hasProjectEnvironment: true, taskCount: 2 })).toBe(true);
  });
});
