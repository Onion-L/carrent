import { describe, expect, it } from "bun:test";

import { resolveWorkspaceThreadRouteData } from "../context/ThreadContentContext";
import { type Message, type SubagentTaskPart } from "../../shared/threadContent";
import type { AppProjectRecord, AppThreadRecord } from "../../shared/workspacePersistence";
import {
  collectSubagentTasks,
  shouldShowInspectorToggle,
} from "../components/chat/ThreadInspectorPane";
import {
  getThreadInspectorInput,
  recordBrowserFocusSequence,
  resolveThreadRouteData,
} from "./ThreadPage";

type TextMessage = {
  id: string;
  role: "user";
  timestamp: string;
  threadId: string;
  content: string;
  type?: "text";
  duration?: string;
};

function makeThread(overrides: Partial<AppThreadRecord> = {}): AppThreadRecord {
  return {
    id: "thread-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    title: "Thread 1",
    createdAt: "2026-07-27T08:00:00.000Z",
    lastActivityAt: "2026-07-27T08:00:00.000Z",
    providerProfileId: "default",
    agentMode: "ask",
    ...overrides,
  };
}

function makeProject(overrides: Partial<AppProjectRecord> = {}): AppProjectRecord {
  return {
    id: "project-1",
    name: "Project 1",
    workingDirectory: "/tmp/project-1",
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
    const projects = [makeProject({ id: "project-1" })];
    const threads = [makeThread({ id: "thread-1" }), makeThread({ id: "thread-2" })];
    const messages: Message[] = [
      makeMessage({ id: "message-1", threadId: "thread-1" }),
      makeMessage({ id: "message-2", threadId: "thread-2" }),
    ];

    const result = resolveThreadRouteData(
      (projectId, threadId) =>
        resolveWorkspaceThreadRouteData(projects, threads, messages, projectId, threadId),
      "project-1",
      "thread-1",
    );

    expect(result?.project.id).toBe("project-1");
    expect(result?.thread.id).toBe("thread-1");
    expect(result?.messages.map((message) => message.id)).toEqual(["message-1"]);
  });

  it("returns null when the thread does not belong to the project", () => {
    const projects = [makeProject({ id: "project-1" }), makeProject({ id: "project-2" })];
    const threads = [
      makeThread({ id: "thread-1", projectId: "project-1" }),
      makeThread({ id: "thread-2", projectId: "project-2" }),
    ];

    expect(
      resolveThreadRouteData(
        (projectId, threadId) =>
          resolveWorkspaceThreadRouteData(projects, threads, [], projectId, threadId),
        "project-1",
        "thread-2",
      ),
    ).toBe(null);
  });
});

describe("recordBrowserFocusSequence", () => {
  it("does not reopen a hidden browser when returning to a thread", () => {
    const seenSequences = new Map<string, number>();

    expect(
      recordBrowserFocusSequence(seenSequences, { threadId: "thread-1", focusSequence: 1 }),
    ).toBe(false);
    expect(
      recordBrowserFocusSequence(seenSequences, { threadId: "thread-2", focusSequence: 1 }),
    ).toBe(false);
    expect(
      recordBrowserFocusSequence(seenSequences, { threadId: "thread-1", focusSequence: 1 }),
    ).toBe(false);
  });

  it("reports a new browser focus event for an already seen thread", () => {
    const seenSequences = new Map([["thread-1", 1]]);

    expect(
      recordBrowserFocusSequence(seenSequences, { threadId: "thread-1", focusSequence: 2 }),
    ).toBe(true);
  });
});

function makeSubagentTask(overrides: Partial<SubagentTaskPart> = {}): SubagentTaskPart {
  return {
    type: "subagent_task",
    id: "task-1",
    providerProfileId: "default",
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
    const projects = [makeProject({ id: "project-1", workingDirectory: "/tmp/project-1" })];
    const threads = [makeThread({ id: "thread-1" })];
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
        resolveWorkspaceThreadRouteData(projects, threads, [taskMessage], projectId, threadId),
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

  it("shows the floating inspector for project threads without subagents", () => {
    expect(shouldShowInspectorToggle({ hasProjectEnvironment: true, taskCount: 0 })).toBe(true);
    expect(shouldShowInspectorToggle({ hasProjectEnvironment: false, taskCount: 0 })).toBe(false);
  });
});
