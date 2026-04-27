import { describe, it, expect } from "bun:test";
import { resolveChatRouteData } from "./ChatPage";
import type { Message, ThreadRecord } from "../mock/uiShellData";

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
    agentId: "a1",
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
