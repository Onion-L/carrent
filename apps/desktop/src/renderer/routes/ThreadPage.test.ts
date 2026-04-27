import { describe, expect, it } from "bun:test";

import { resolveWorkspaceThreadRouteData } from "../context/WorkspaceContext";
import type { DraftThreadRecord } from "../lib/draftThreads";
import {
  messages as seededMessages,
  projects as seededProjects,
  type Message,
  type ProjectRecord,
  type ThreadRecord,
} from "../mock/uiShellData";
import { findPromotedDraftToFinalize, resolveThreadRouteData } from "./ThreadPage";

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

function makeDraft(overrides: Partial<DraftThreadRecord> = {}): DraftThreadRecord {
  return {
    draftId: "draft-1",
    projectId: "project-1",
    title: "Draft 1",
    preallocatedThreadId: "thread-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    messages: [],
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

describe("findPromotedDraftToFinalize", () => {
  it("returns the promoted draft that matches the real thread route", () => {
    const result = findPromotedDraftToFinalize(
      [
        makeDraft(),
        makeDraft({
          draftId: "draft-2",
          promotedToThreadId: "thread-99",
        }),
      ],
      "project-1",
      "thread-99",
    );

    expect(result?.draftId).toBe("draft-2");
  });

  it("returns null when the thread route has no promoted draft", () => {
    expect(
      findPromotedDraftToFinalize(
        [makeDraft({ promotedToThreadId: "thread-99" })],
        "project-1",
        "thread-1",
      ),
    ).toBe(null);
  });
});
