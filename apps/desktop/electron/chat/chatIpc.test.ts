import { describe, expect, it } from "bun:test";
import type { ChatRunEvent, ChatTurnRequest } from "../../src/shared/chat";
import { registerChatIpc } from "./chatIpc";
import type { ChatRunnerResult } from "./chatRunner";

function makeRequest(
  overrides: Partial<ChatTurnRequest> = {},
): ChatTurnRequest {
  return {
    projectPath: "/Users/onion/workbench/timbre",
    threadId: "thread-1",
    runtimeId: "codex",
    agent: {
      id: "architect",
      name: "Architect",
      responsibility: "You are an architect.",
    },
    transcript: [],
    message: "Hello",
    ...overrides,
  };
}

describe("registerChatIpc", () => {
  it("registers chat:send and chat:stop channels", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerChatIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        chatRunner: {
          run: () => Promise.resolve({ ok: true, text: "hi" } as ChatRunnerResult),
        },
        emit: () => {},
      },
    );

    expect([...handlers.keys()].sort()).toEqual(["chat:send", "chat:stop"]);
  });

  it("chat:send returns a runId and emits completed on success", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const emitted: ChatRunEvent[] = [];

    registerChatIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        chatRunner: {
          run: () => Promise.resolve({ ok: true, text: "Done" }),
        },
        emit: (evt) => emitted.push(evt),
      },
    );

    const result = (await handlers.get("chat:send")?.({}, makeRequest())) as {
      runId: string;
    };
    expect(result.runId).toBeString();

    const completed = emitted.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect(completed).toMatchObject({
      type: "completed",
      runId: result.runId,
      text: "Done",
    });
  });

  it("chat:send emits failed on runner error", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const emitted: ChatRunEvent[] = [];

    registerChatIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        chatRunner: {
          run: () => Promise.resolve({ ok: false, error: "Boom" }),
        },
        emit: (evt) => emitted.push(evt),
      },
    );

    const result = (await handlers.get("chat:send")?.({}, makeRequest())) as {
      runId: string;
    };

    const failed = emitted.find((e) => e.type === "failed");
    expect(failed).toBeDefined();
    expect(failed).toMatchObject({
      type: "failed",
      runId: result.runId,
      error: "Boom",
    });
  });
});
