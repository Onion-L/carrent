import { describe, expect, it } from "bun:test";

import type { Message, ProjectRecord, ThreadRecord } from "../mock/uiShellData";
import { resolveThreadRouteData } from "./ThreadPage";

type TextMessage = {
  id: string;
  role: "user";
  agentId: string;
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
    agentId: "architect",
    timestamp: "09:00",
    threadId: "thread-1",
    content: "hello",
    ...overrides,
  };
}

describe("resolveThreadRouteData", () => {
  it("returns the matching project, thread, and messages", () => {
    const projects = [
      makeProject(
        { id: "project-1" },
        [makeThread({ id: "thread-1" }), makeThread({ id: "thread-2" })],
      ),
    ];
    const messages: Message[] = [
      makeMessage({ id: "message-1", threadId: "thread-1" }),
      makeMessage({ id: "message-2", threadId: "thread-2" }),
    ];

    const result = resolveThreadRouteData(projects, messages, "project-1", "thread-1");

    expect(result?.project.id).toBe("project-1");
    expect(result?.thread.id).toBe("thread-1");
    expect(result?.messages.map((message) => message.id)).toEqual(["message-1"]);
  });

  it("returns null when the thread does not belong to the project", () => {
    const projects = [
      makeProject({ id: "project-1" }, [makeThread({ id: "thread-1" })]),
      makeProject({ id: "project-2" }, [makeThread({ id: "thread-2" })]),
    ];

    expect(resolveThreadRouteData(projects, [], "project-1", "thread-2")).toBe(null);
  });

  it("maps the verification route to the seeded active thread", () => {
    const projects = [
      makeProject(
        { id: "carrent", active: true },
        [makeThread({ id: "thread-carrent", active: true, title: "Seeded thread" })],
      ),
    ];
    const messages: Message[] = [
      makeMessage({ id: "message-seeded", threadId: "thread-carrent" }),
    ];

    const result = resolveThreadRouteData(
      projects,
      messages,
      "project-1",
      "thread-1",
    );

    expect(result?.project.id).toBe("carrent");
    expect(result?.thread.id).toBe("thread-carrent");
    expect(result?.messages.map((message) => message.id)).toEqual(["message-seeded"]);
  });
});
