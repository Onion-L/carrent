import { describe, it, expect } from "bun:test";
import { getChatInspectorInput, resolveChatRouteData } from "./ChatPage";
import {
  collectSubagentTasks,
  shouldShowInspectorToggle,
} from "../components/chat/ThreadInspectorPane";
import type { Message, SubagentTaskPart, ThreadRecord } from "../mock/uiShellData";

function makeThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "chat-1",
    title: "Chat One",
    updatedAt: "1h",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    threadId: "chat-1",
    role: "user",
    content: "hello",
    timestamp: "09:00",
    type: "text",
    ...overrides,
  } as Message;
}

describe("resolveChatRouteData", () => {
  it("returns null without a thread id", () => {
    expect(resolveChatRouteData(() => null, undefined)).toBe(null);
  });

  it("returns chat route data for a thread id", () => {
    const thread = makeThread({ id: "chat-1" });
    const messages = [makeMessage({ threadId: "chat-1" })];
    const getChatRouteData = (id: string) => {
      if (id === "chat-1") {
        return { thread, messages };
      }
      return null;
    };

    const result = resolveChatRouteData(getChatRouteData, "chat-1");
    expect(result?.thread.id).toBe("chat-1");
    expect(result?.messages).toEqual(messages);
  });

  it("returns null for a missing thread", () => {
    const getChatRouteData = () => null;
    expect(resolveChatRouteData(getChatRouteData, "missing")).toBe(null);
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

describe("chat inspector integration", () => {
  it("passes messages to the inspector without a project path", () => {
    const thread = makeThread({ id: "chat-1" });
    const taskMessage = makeMessage({
      id: "message-task",
      role: "assistant",
      content: "",
      parts: [makeSubagentTask({ id: "task-1" })],
    });
    const getChatRouteData = (id: string) => {
      if (id === "chat-1") {
        return { thread, messages: [taskMessage] };
      }
      return null;
    };

    const routeData = resolveChatRouteData(getChatRouteData, "chat-1");
    const input = getChatInspectorInput(routeData);

    expect(input && "projectPath" in input).toBe(false);
    expect(collectSubagentTasks(input?.messages ?? []).map((task) => task.id)).toEqual(["task-1"]);
  });

  it("shows the toggle only when a general Chat has tasks", () => {
    expect(shouldShowInspectorToggle({ hasProjectEnvironment: false, taskCount: 0 })).toBe(false);
    expect(shouldShowInspectorToggle({ hasProjectEnvironment: false, taskCount: 1 })).toBe(true);
  });

  it("returns null inspector input for a missing chat", () => {
    expect(getChatInspectorInput(null)).toBe(null);
  });
});
