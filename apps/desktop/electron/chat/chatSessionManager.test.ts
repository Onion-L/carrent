import { describe, expect, it } from "bun:test";

import type { ChatTurnRequest } from "../../src/shared/chat";
import { createAgentDebugStore } from "./agentDebugStore";
import { createChatSessionManager } from "./chatSessionManager";

function request(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    context: {
      kind: "project",
      workingDirectory: process.cwd(),
      projectId: "project-1",
      workspaceId: "workspace-1",
    },
    threadId: "thread-1",
    providerProfileId: "default",
    agentMode: "ask",
    transcript: [],
    message: "hello",
    ...overrides,
  };
}

describe("createChatSessionManager", () => {
  it("reports missing Provider Profile configuration", async () => {
    const events: Array<{ type: string; error?: string }> = [];
    const manager = createChatSessionManager({
      emit: (event) => events.push(event),
      loadAuth: async () => null,
    });

    manager.start("run-1", request());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.map((event) => event.type)).toEqual(["started", "failed"]);
    expect(events[1]?.error).toContain("auth.json");
  });

  it("maps Agent Core text and tool events into Run events", async () => {
    const events: Array<{ type: string; text?: string }> = [];
    const debugStore = createAgentDebugStore();
    const fakeCore = {
      run(input: { onEvent?: (event: unknown) => void }) {
        input.onEvent?.({ type: "text-delta", delta: "done" });
        input.onEvent?.({ type: "agent-event", event: { type: "agent_start" } });
        return {
          cancel() {},
          result: Promise.resolve({ text: "done", messages: [] }),
        };
      },
    };
    const manager = createChatSessionManager({
      emit: (event) => events.push(event),
      agentCore: fakeCore as never,
      debugStore,
      loadAuth: async () => ({
        version: 1,
        activeProfileId: "default",
        profiles: {
          default: {
            id: "default",
            type: "anthropic",
            apiKey: "secret",
            baseUrl: "https://api.anthropic.com",
            modelId: "claude-test",
          },
        },
      }),
    });

    manager.start("run-1", request());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.map((event) => event.type)).toEqual(["started", "delta", "completed"]);
    expect(debugStore.getTrace("thread-1")?.records.map((record) => record.type)).toEqual([
      "run.requested",
      "agent_start",
      "run.completed",
    ]);
  });
});
