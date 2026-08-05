import { describe, expect, it } from "bun:test";
import { appendFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ChatRunEvent, ChatTurnRequest, KimiTimelineItem } from "../../src/shared/chat";
import { MAX_SUBAGENT_TASK_TEXT_LENGTH } from "../../src/shared/workspacePersistence";
import type { CarrentBridgeFactory, CarrentBridgeHandle } from "../bridge/carrentBridge";
import {
  buildKimiPromptParts,
  getKimiSessionStatus,
  startKimiAcpChatRun,
  type KimiAcpTransport,
} from "./kimiAcpChat";
import {
  startQuestionMcpServer,
  type QuestionMcpServerFactory,
  type QuestionMcpServerHandle,
} from "./questionMcpServer";

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    context: {
      kind: "project",
      workspaceId: "workspace-1",
      projectId: "carrent",
      workingDirectory: "/Users/onion/workbench/carrent",
    },
    threadId: "thread-1",
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
    transcript: [],
    message: "Hello",
    ...overrides,
  };
}

function respondAcp(
  transport: FakeKimiAcpTransport,
  request: Record<string, unknown>,
  result: unknown,
) {
  transport.emitMessage({ jsonrpc: "2.0", id: request.id, result });
}

function waitForAsyncEvents() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createFakeCarrentBridgeFactory() {
  const handles: Array<CarrentBridgeHandle & { closed: boolean }> = [];
  const factory: CarrentBridgeFactory = async ({ runId }) => {
    const handle: CarrentBridgeHandle & { closed: boolean } = {
      closed: false,
      mcpServer: {
        id: "carrent_bridge",
        name: "carrent_bridge",
        type: "http",
        url: `http://127.0.0.1/${runId}/mcp?token=test`,
        headers: [],
      },
      async close() {
        handle.closed = true;
      },
    };
    handles.push(handle);
    return handle;
  };

  return { factory, handles };
}

class FakeKimiAcpTransport implements KimiAcpTransport {
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly messageListeners: Array<(message: Record<string, unknown>) => void> = [];
  private readonly errorListeners: Array<(error: Error) => void> = [];
  private readonly closeListeners: Array<
    (details: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => void
  > = [];

  constructor(
    private readonly onSend: (
      transport: FakeKimiAcpTransport,
      message: Record<string, unknown>,
    ) => void,
  ) {}

  send(message: Record<string, unknown>) {
    this.sent.push(message);
    this.onSend(this, message);
  }

  close() {}

  onMessage(listener: (message: Record<string, unknown>) => void) {
    this.messageListeners.push(listener);
  }

  onError(listener: (error: Error) => void) {
    this.errorListeners.push(listener);
  }

  onClose(
    listener: (details: {
      code: number | null;
      signal: NodeJS.Signals | null;
      stderr: string;
    }) => void,
  ) {
    this.closeListeners.push(listener);
  }

  emitMessage(message: Record<string, unknown>) {
    this.messageListeners.forEach((listener) => listener(message));
  }

  emitError(error: Error) {
    this.errorListeners.forEach((listener) => listener(error));
  }

  emitClose(details: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) {
    this.closeListeners.forEach((listener) => listener(details));
  }
}

describe("buildKimiPromptParts", () => {
  it("does not inject RTK instructions into Kimi prompts", async () => {
    const parts = await buildKimiPromptParts(makeRequest({ message: "Check git status" }));

    expect(parts).toEqual([{ type: "text", text: "Check git status" }]);
  });

  it("uses ACP image blocks for image-only messages", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-image-"));
    const imagePath = path.join(dir, "a1.png");
    await writeFile(imagePath, Buffer.from("image bytes"));

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        attachments: [
          {
            id: "a1",
            kind: "image" as const,
            name: "screen.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
            localPath: imagePath,
          },
        ],
      }),
    );

    expect(parts).toEqual([
      { type: "text", text: "Inspect the attached images and describe what you see." },
      {
        type: "image",
        data: Buffer.from("image bytes").toString("base64"),
        mimeType: "image/png",
        uri: `file://${imagePath}`,
      },
    ]);
  });

  it("includes bounded transcript text for fresh sessions", async () => {
    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "Follow up",
        transcript: [
          { role: "user" as const, content: "First" },
          { role: "assistant" as const, content: "First answer" },
        ],
      }),
      { includeTranscript: true },
    );

    expect(parts).toHaveLength(1);
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("Recent conversation:");
    expect(text).toContain("user: First");
    expect(text).toContain("assistant: First answer");
    expect(text).toContain("user: Follow up");
  });

  it("does not duplicate local image paths in text when including transcript", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-image-transcript-"));
    const imagePath = path.join(dir, "a1.png");
    await writeFile(imagePath, Buffer.from("image bytes"));

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        transcript: [{ role: "user" as const, content: "Earlier" }],
        attachments: [
          {
            id: "a1",
            kind: "image" as const,
            name: "screen.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
            localPath: imagePath,
          },
        ],
      }),
      { includeTranscript: true },
    );

    expect(parts).toHaveLength(2);
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("user: Earlier");
    expect(text).not.toContain("Attached images:");
    expect(text).not.toContain(imagePath);
    expect(parts[1]).toEqual({
      type: "image",
      data: Buffer.from("image bytes").toString("base64"),
      mimeType: "image/png",
      uri: `file://${imagePath}`,
    });
  });

  it("emits one text part followed by image and resource-link parts in selection order", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-mixed-parts-"));
    const filePath = path.join(dir, "a1.ts");
    const imagePath = path.join(dir, "a2.png");
    await writeFile(filePath, "const x = 1;\n");
    await writeFile(imagePath, Buffer.from("image bytes"));

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "Check these",
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "main.ts",
            mimeType: "text/plain",
            size: 512,
            storageKey: "a1.ts",
            localPath: filePath,
          },
          {
            id: "a2",
            kind: "image" as const,
            name: "screen.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a2.png",
            localPath: imagePath,
          },
        ],
      }),
    );

    expect(parts).toEqual([
      { type: "text", text: "Check these" },
      {
        type: "resource_link",
        uri: `file://${filePath}`,
        name: "main.ts",
        mimeType: "text/plain",
        size: 512,
      },
      {
        type: "image",
        data: Buffer.from("image bytes").toString("base64"),
        mimeType: "image/png",
        uri: `file://${imagePath}`,
      },
    ]);
  });

  it("uses the generic default prompt for file-only requests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-file-default-"));
    const filePath = path.join(dir, "a1.md");
    await writeFile(filePath, "# notes\n");

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "notes.md",
            mimeType: "text/plain",
            size: 8,
            storageKey: "a1.md",
            localPath: filePath,
          },
        ],
      }),
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      type: "text",
      text: "Inspect the attached files and summarize the relevant contents.",
    });
    expect(parts[1]).toMatchObject({ type: "resource_link", name: "notes.md" });
  });

  it("appends file resource links without duplicating paths in transcript text", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-file-transcript-"));
    const filePath = path.join(dir, "a1.ts");
    await writeFile(filePath, "const x = 1;\n");

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        transcript: [{ role: "user" as const, content: "Earlier" }],
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "main.ts",
            mimeType: "text/plain",
            size: 512,
            storageKey: "a1.ts",
            localPath: filePath,
          },
        ],
      }),
      { includeTranscript: true },
    );

    expect(parts).toHaveLength(2);
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("user: Earlier");
    expect(text).not.toContain("Attached files:");
    expect(text).not.toContain(filePath);
    expect(parts[1]).toEqual({
      type: "resource_link",
      uri: `file://${filePath}`,
      name: "main.ts",
      mimeType: "text/plain",
      size: 512,
    });
  });
});

describe("startKimiAcpChatRun", () => {
  it("emits ordered Kimi thinking phases and message segments", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-timeline" });
        return;
      }
      if (message.method !== "session/prompt") return;

      for (const update of [
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Inspect" },
        },
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: " files" },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "I found" },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: " it." },
        },
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Before tool" },
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "existing-tool",
          title: "ReadFile",
          status: "in_progress",
        },
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Before plan" },
        },
        { sessionUpdate: "future_kimi_update", content: { type: "text", text: "ignored" } },
        {
          sessionUpdate: "plan",
          entries: [{ content: "Verify the result", status: "in_progress" }],
        },
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Verify" },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done." },
        },
      ]) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "session-timeline", update },
        });
      }
      respondAcp(fakeTransport, message, { stopReason: "end_turn" });
    });

    startKimiAcpChatRun({
      runId: "run-kimi-timeline",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    const timeline = emitted
      .filter(
        (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
          event.type === "kimi-timeline",
      )
      .map((event) => event.item);
    expect(timeline).toEqual([
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-1",
        order: 0,
        content: "Inspect",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-1",
        order: 0,
        content: "Inspect files",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-1",
        order: 0,
        content: "Inspect files",
        status: "completed",
      },
      {
        type: "message",
        id: "kimi-run-kimi-timeline-message-1",
        order: 1,
        content: "I found",
        isFinal: false,
      },
      {
        type: "message",
        id: "kimi-run-kimi-timeline-message-1",
        order: 1,
        content: "I found it.",
        isFinal: false,
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-2",
        order: 2,
        content: "Before tool",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-2",
        order: 2,
        content: "Before tool",
        status: "completed",
      },
      {
        type: "tool",
        id: "kimi-run-kimi-timeline-tool-item-3",
        order: 3,
        toolCallId: "existing-tool",
        title: "ReadFile",
        kind: "",
        command: "",
        filePath: "",
        input: "",
        output: "",
        error: "",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-3",
        order: 4,
        content: "Before plan",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-3",
        order: 4,
        content: "Before plan",
        status: "completed",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-4",
        order: 5,
        content: "Verify",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-timeline-thinking-4",
        order: 5,
        content: "Verify",
        status: "completed",
      },
      {
        type: "message",
        id: "kimi-run-kimi-timeline-message-2",
        order: 6,
        content: "Done.",
        isFinal: false,
      },
      {
        type: "message",
        id: "kimi-run-kimi-timeline-message-2",
        order: 6,
        content: "Done.",
        isFinal: true,
      },
      {
        type: "tool",
        id: "kimi-run-kimi-timeline-tool-item-3",
        order: 3,
        toolCallId: "existing-tool",
        title: "ReadFile",
        kind: "",
        command: "",
        filePath: "",
        input: "",
        output: "",
        error: "",
        status: "cancelled",
      },
    ]);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Done.",
    });
    expect(emitted.filter((event) => event.type === "checklist")).toEqual([
      {
        type: "checklist",
        runId: "run-kimi-timeline",
        threadId: "thread-1",
        runtimeId: "kimi",
        checklist: {
          entries: [{ content: "Verify the result", status: "in_progress" }],
        },
      },
    ]);
    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/new",
      "session/prompt",
    ]);
  });

  it("ignores late ACP activity and transport callbacks after the prompt response", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-terminal-freeze" });
        return;
      }
      if (message.method !== "session/prompt") return;

      fakeTransport.emitMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-terminal-freeze",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Authoritative answer" },
          },
        },
      });
      respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      fakeTransport.emitMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-terminal-freeze",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Late rewrite" },
          },
        },
      });
      fakeTransport.emitClose({ code: 1, signal: null, stderr: "late close" });
      fakeTransport.emitError(new Error("late transport error"));
    });

    startKimiAcpChatRun({
      runId: "run-kimi-terminal-freeze",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    const completed = emitted.filter((event) => event.type === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ type: "completed", text: "Authoritative answer" });
    expect(emitted.some((event) => event.type === "failed")).toBe(false);
    expect(
      emitted.some(
        (event) =>
          event.type === "kimi-timeline" &&
          event.item.type === "message" &&
          event.item.content.includes("Late rewrite"),
      ),
    ).toBe(false);
  });

  it("maps an ACP plan update to an ordered Run Checklist snapshot", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-checklist" });
        return;
      }
      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-checklist",
            update: {
              sessionUpdate: "plan",
              entries: [
                { content: "Inspect the existing flow", status: "completed", priority: "medium" },
                { content: "Implement the checklist", status: "in_progress", priority: "medium" },
                { content: "Run verification", status: "pending", priority: "medium" },
              ],
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-checklist",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "checklist")).toEqual({
      type: "checklist",
      runId: "run-kimi-checklist",
      threadId: "thread-1",
      runtimeId: "kimi",
      checklist: {
        entries: [
          { content: "Inspect the existing flow", status: "completed" },
          { content: "Implement the checklist", status: "in_progress" },
          { content: "Run verification", status: "pending" },
        ],
      },
    });
  });

  it("completes normally when Kimi sends no plan update", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-without-plan" });
        return;
      }
      if (message.method !== "session/prompt") return;

      fakeTransport.emitMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-without-plan",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done without a plan." },
          },
        },
      });
      respondAcp(fakeTransport, message, { stopReason: "end_turn" });
    });

    startKimiAcpChatRun({
      runId: "run-kimi-without-plan",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(emitted.filter((event) => event.type === "checklist")).toHaveLength(0);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Done without a plan.",
    });
    expect(emitted.some((event) => event.type === "failed")).toBe(false);
  });

  it("ignores unknown ACP updates without disturbing known timeline items or terminal state", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-unknown-update" });
        return;
      }
      if (message.method !== "session/prompt") return;

      for (const update of [
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Inspect" },
        },
        {
          sessionUpdate: "future_kimi_update",
          content: { type: "text", text: "Must be ignored" },
        },
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: " files" },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done." },
        },
      ]) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "session-unknown-update", update },
        });
      }
      respondAcp(fakeTransport, message, { stopReason: "end_turn" });
    });

    startKimiAcpChatRun({
      runId: "run-kimi-unknown-update",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    const timeline = emitted
      .filter(
        (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
          event.type === "kimi-timeline",
      )
      .map((event) => event.item);
    expect(timeline).toEqual([
      {
        type: "thinking",
        id: "kimi-run-kimi-unknown-update-thinking-1",
        order: 0,
        content: "Inspect",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-unknown-update-thinking-1",
        order: 0,
        content: "Inspect files",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-unknown-update-thinking-1",
        order: 0,
        content: "Inspect files",
        status: "completed",
      },
      {
        type: "message",
        id: "kimi-run-kimi-unknown-update-message-1",
        order: 1,
        content: "Done.",
        isFinal: false,
      },
      {
        type: "message",
        id: "kimi-run-kimi-unknown-update-message-1",
        order: 1,
        content: "Done.",
        isFinal: true,
      },
    ]);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Done.",
    });
    expect(emitted.some((event) => event.type === "failed" || event.type === "stopped")).toBe(
      false,
    );
  });

  it("omits TodoList activity when the Run Checklist carries the same progress", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-checklist" });
        return;
      }
      if (message.method === "session/prompt") {
        setTimeout(() => {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-checklist",
              update: {
                sessionUpdate: "tool_call",
                toolCallId: "tool-todo-list",
                title: "TodoList",
                kind: "other",
                status: "in_progress",
              },
            },
          });
          setTimeout(() => {
            for (const update of [
              {
                sessionUpdate: "plan",
                entries: [{ content: "Implement the checklist", status: "in_progress" }],
              },
              {
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-todo-list",
                title: "TodoList",
                kind: "other",
                status: "completed",
              },
            ]) {
              fakeTransport.emitMessage({
                jsonrpc: "2.0",
                method: "session/update",
                params: { sessionId: "session-checklist", update },
              });
            }
            respondAcp(fakeTransport, message, { stopReason: "end_turn" });
          }, 0);
        }, 0);
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-checklist",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(emitted.filter((event) => event.type === "checklist")).toHaveLength(1);
    expect(
      emitted.some(
        (event) => event.type === "reasoning" && event.reasoning.id === "kimi-tool-tool-todo-list",
      ),
    ).toBe(false);
  });

  it("accepts empty Plan Mode snapshots and ignores malformed replacements atomically", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, {
          sessionId: "session-plan-checklist",
          configOptions: [
            {
              id: "mode",
              currentValue: "default",
              options: [
                { value: "default", name: "Default" },
                { value: "plan", name: "Plan" },
              ],
            },
          ],
        });
        return;
      }
      if (message.method === "session/set_config_option") {
        respondAcp(fakeTransport, message, {});
        return;
      }
      if (message.method === "session/prompt") {
        for (const entries of [
          [{ content: "Valid snapshot", status: "in_progress" }],
          [
            { content: "Valid first item", status: "completed" },
            { content: "Invalid second item", status: "blocked" },
          ],
          [{ content: "x".repeat(8 * 1024 + 1), status: "pending" }],
          [],
        ]) {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-plan-checklist",
              update: { sessionUpdate: "plan", entries },
            },
          });
        }
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-plan-checklist",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Done" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-plan-checklist",
      request: makeRequest({ planMode: true }),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(
      emitted
        .filter((event) => event.type === "checklist")
        .map((event) => (event.type === "checklist" ? event.checklist.entries : null)),
    ).toEqual([[{ content: "Valid snapshot", status: "in_progress" }], []]);
    expect(emitted.find((event) => event.type === "failed")).toBeUndefined();
  });

  it("preserves TodoList activity when no valid Run Checklist snapshot is available", async () => {
    const emitted: ChatRunEvent[] = [];
    let eventsBeforeTerminal: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-invalid-checklist" });
        return;
      }
      if (message.method === "session/prompt") {
        for (const update of [
          {
            sessionUpdate: "tool_call",
            toolCallId: "tool-todo-list",
            title: "TodoList",
            kind: "other",
            status: "in_progress",
          },
          {
            sessionUpdate: "plan",
            entries: [{ content: "Invalid snapshot", status: "blocked" }],
          },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-todo-list",
            title: "TodoList",
            kind: "other",
            status: "completed",
          },
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          },
        ]) {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "session-invalid-checklist", update },
          });
        }
        eventsBeforeTerminal = [...emitted];
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-invalid-checklist",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(emitted.filter((event) => event.type === "checklist")).toHaveLength(0);
    expect(
      emitted
        .filter(
          (event) =>
            event.type === "reasoning" && event.reasoning.id === "kimi-tool-tool-todo-list",
        )
        .map((event) => (event.type === "reasoning" ? event.reasoning.status : null)),
    ).toEqual(["running", "completed"]);
    expect(
      eventsBeforeTerminal.filter(
        (event) => event.type === "reasoning" && event.reasoning.id === "kimi-tool-tool-todo-list",
      ),
    ).toHaveLength(2);
    expect(
      emitted.findIndex(
        (event) => event.type === "reasoning" && event.reasoning.id === "kimi-tool-tool-todo-list",
      ),
    ).toBeLessThan(emitted.findIndex((event) => event.type === "delta"));
  });

  it("keeps TodoList activity around an empty Run Checklist snapshot", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-empty-checklist" });
        return;
      }
      if (message.method === "session/prompt") {
        for (const update of [
          {
            sessionUpdate: "tool_call",
            toolCallId: "tool-todo-list",
            title: "TodoList",
            kind: "other",
            status: "in_progress",
          },
          { sessionUpdate: "plan", entries: [] },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-todo-list",
            title: "TodoList",
            kind: "other",
            status: "completed",
          },
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          },
        ]) {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "session-empty-checklist", update },
          });
        }
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-empty-checklist",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    const relevantEvents = emitted.filter(
      (event) =>
        event.type === "checklist" ||
        event.type === "delta" ||
        (event.type === "reasoning" && event.reasoning.id === "kimi-tool-tool-todo-list"),
    );
    expect(
      relevantEvents.map((event) =>
        event.type === "reasoning" ? event.reasoning.status : event.type,
      ),
    ).toEqual(["running", "checklist", "completed", "delta"]);
    expect(relevantEvents.find((event) => event.type === "checklist")).toMatchObject({
      checklist: { entries: [] },
    });
  });

  it("returns parsed session status from a /status prompt", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [
                { name: "compact" },
                { name: "status" },
                { name: "unknown-runtime-command" },
              ],
            },
          },
        });
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: "Session status:\n- Model: kimi-code/kimi-for-coding\n- Thinking: on\n- Permission: manual\n- Plan mode: off\n- Context: 21,169 / 262,144 (8.1%)",
              },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/code/carrent",
      transportFactory: () => transport,
    });

    expect(status).toEqual({
      model: "kimi-code/kimi-for-coding",
      used: 21169,
      total: 262144,
      percentage: 8.1,
      threadActions: ["compact"],
      supportedCommands: ["compact", "status"],
    });
    expect(
      (
        transport.sent.find((message) => message.method === "session/prompt")?.params as {
          prompt?: unknown;
        }
      )?.prompt,
    ).toEqual([{ type: "text", text: "/status" }]);
  });

  it("does not send /status unless the exact capability is advertised", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "status-report" }, { name: "usage" }],
            },
          },
        });
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/code/carrent",
      transportFactory: () => transport,
    });

    expect(status).toBe(null);
    expect(transport.sent.some((message) => message.method === "session/prompt")).toBe(false);
  });

  it("waits for commands advertised after the resume response", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        respondAcp(fakeTransport, message, { configOptions: [] });
        setTimeout(() => {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "available_commands_update",
                availableCommands: [{ name: "status" }],
              },
            },
          });
        }, 0);
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Context: 35,193 / 1,048,576 (3.4%)" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/code/carrent",
      transportFactory: () => transport,
    });

    expect(status).toMatchObject({
      used: 35193,
      total: 1048576,
      percentage: 3.4,
      supportedCommands: ["status"],
    });
    expect(transport.sent.some((message) => message.method === "session/prompt")).toBe(true);
  });

  it("normalizes chunked optional plan usage independently", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              commands: [{ name: "status" }],
            },
          },
        });
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        for (const text of [
          "Session status:\n- Context: 35,193 / 1,048,576 (3.4%)\n- Week",
          "ly: 24.5% used, resets in 3d 8h\n- Unknown: ignored\n- 5h: 12% used",
        ]) {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text },
              },
            },
          });
        }
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/code/carrent",
      transportFactory: () => transport,
    });

    expect(status?.planUsage).toEqual({
      weekly: { usedPercentage: 24.5, reset: "in 3d 8h" },
      fiveHour: { usedPercentage: 12 },
    });
  });

  it("omits malformed optional quota windows without invalidating context", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "status" }],
            },
          },
        });
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: "Context: 10 / 100 (10%)\nWeekly: 125% used, resets in 3d\n5h: 25% used, resets at 14:30",
              },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/code/carrent",
      transportFactory: () => transport,
    });

    expect(status?.planUsage).toEqual({
      weekly: { reset: "in 3d" },
      fiveHour: { usedPercentage: 25, reset: "at 14:30" },
    });
  });

  it("returns null when status text does not contain context usage", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "status" }],
            },
          },
        });
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "No usage data here." },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/Users/onion/workbench/carrent",
      transportFactory: () => transport,
    });

    expect(status).toBe(null);
  });

  for (const statusText of [
    "Context: 10 / 0 (10%)",
    "Context: 101 / 100 (10%)",
    "Context: 10 / 100 (101%)",
    "Context: 10 / 100 (...)%",
  ]) {
    it(`returns null for malformed required context data: ${statusText}`, async () => {
      const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
        if (message.method === "initialize") {
          respondAcp(fakeTransport, message, { protocolVersion: 1 });
          return;
        }

        if (message.method === "session/resume") {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "available_commands_update",
                availableCommands: [{ name: "status" }],
              },
            },
          });
          respondAcp(fakeTransport, message, { sessionId: "session-1" });
          return;
        }

        if (message.method === "session/prompt") {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: statusText },
              },
            },
          });
          respondAcp(fakeTransport, message, { stopReason: "end_turn" });
        }
      });

      const status = await getKimiSessionStatus({
        sessionId: "session-1",
        cwd: "/code/carrent",
        transportFactory: () => transport,
      });

      expect(status).toBe(null);
    });
  }

  it("does not attach MCP servers to non-Run status checks", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "status" }],
            },
          },
        });
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/Users/onion/workbench/carrent",
      transportFactory: () => transport,
    });

    const resumeParams = transport.sent.find((message) => message.method === "session/resume")
      ?.params as { mcpServers?: unknown[] } | undefined;
    expect(resumeParams?.mcpServers).toEqual([]);
  });

  it("does not install a Carrent-side runtime timeout for session/prompt", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timeoutDelays: unknown[] = [];

    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const timer = { handler, timeout, args };
      timeoutDelays.push(timeout);
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

    try {
      const emitted: ChatRunEvent[] = [];
      const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
        if (message.method === "initialize") {
          respondAcp(fakeTransport, message, { protocolVersion: 1 });
          return;
        }

        if (message.method === "session/new") {
          respondAcp(fakeTransport, message, { sessionId: "session-1" });
          return;
        }

        if (message.method === "session/prompt") {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Done" },
              },
            },
          });
          respondAcp(fakeTransport, message, { stopReason: "end_turn" });
        }
      });

      startKimiAcpChatRun({
        runId: "run-kimi-no-prompt-timeout",
        request: makeRequest({ runtimeId: "kimi" }),
        cwd: "/Users/onion/workbench/carrent",
        emit: (event) => emitted.push(event),
        transportFactory: () => transport,
        requestTimeoutMs: 7,
      });

      for (let i = 0; i < 25; i += 1) {
        await Promise.resolve();
      }

      expect(timeoutDelays).toEqual([7, 7]);
      expect(transport.sent.map((message) => message.method)).toEqual([
        "initialize",
        "session/new",
        "session/prompt",
      ]);
      expect(emitted.find((event) => event.type === "completed")).toMatchObject({
        text: "Done",
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("passes Carrent Bridge to new Kimi ACP sessions and closes it on completion", async () => {
    const emitted: ChatRunEvent[] = [];
    const bridge = createFakeCarrentBridgeFactory();
    let sessionNewParams: unknown = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        sessionNewParams = message.params;
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Done" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-bridge-new",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
    });

    await waitForAsyncEvents();

    expect(sessionNewParams).toMatchObject({
      mcpServers: [bridge.handles[0]!.mcpServer],
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Done",
    });
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("opens Kimi ACP sessions without MCP servers when Local MCP Server is off", async () => {
    const emitted: ChatRunEvent[] = [];
    let sessionNewParams: unknown = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        sessionNewParams = message.params;
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "No skills needed" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-no-local-mcp",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => null,
    });

    await waitForAsyncEvents();

    expect(sessionNewParams).toMatchObject({ mcpServers: [] });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "No skills needed",
    });
  });

  it("passes Carrent Bridge to resumed Kimi ACP sessions", async () => {
    const bridge = createFakeCarrentBridgeFactory();
    let sessionResumeParams: unknown = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        sessionResumeParams = message.params;
        respondAcp(fakeTransport, message, { sessionId: "session-previous" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-previous",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Resumed" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const emitted: ChatRunEvent[] = [];
    startKimiAcpChatRun({
      runId: "run-kimi-bridge-resume",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
      resumeSessionId: "session-previous",
    });

    await waitForAsyncEvents();

    expect(sessionResumeParams).toMatchObject({
      sessionId: "session-previous",
      mcpServers: [bridge.handles[0]!.mcpServer],
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Resumed",
    });
  });

  it("closes Carrent Bridge when a Kimi ACP prompt fails", async () => {
    const emitted: ChatRunEvent[] = [];
    const bridge = createFakeCarrentBridgeFactory();
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "prompt failed" },
        });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-bridge-prompt-fail",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
    });

    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      error: "prompt failed",
    });
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("fails the run when Kimi ACP declines the request (provider refusal)", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        respondAcp(fakeTransport, message, { stopReason: "refusal" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-refusal",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => null,
    });

    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "completed")).toBeUndefined();
    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      error: "Kimi Code declined the request (provider refusal).",
    });
  });

  it("fails the run when Kimi ACP ends with an unknown stop reason", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        respondAcp(fakeTransport, message, { stopReason: "error" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-unknown-stop",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => null,
    });

    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "completed")).toBeUndefined();
    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      error: "Kimi Code ended the run unexpectedly (stop reason: error).",
    });
  });

  for (const [label, promptResult, preservedReason] of [
    ["missing", {}, "missing"],
    ["empty", { stopReason: "" }, '""'],
    ["non-string", { stopReason: 42 }, "42"],
  ] as const) {
    it(`fails the run when Kimi ACP returns a ${label} stop reason`, async () => {
      const emitted: ChatRunEvent[] = [];
      const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
        if (message.method === "initialize") {
          respondAcp(fakeTransport, message, { protocolVersion: 1 });
          return;
        }
        if (message.method === "session/new") {
          respondAcp(fakeTransport, message, { sessionId: `session-${label}-stop` });
          return;
        }
        if (message.method === "session/prompt") {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: `session-${label}-stop`,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Must not complete" },
              },
            },
          });
          respondAcp(fakeTransport, message, promptResult);
        }
      });

      startKimiAcpChatRun({
        runId: `run-kimi-${label}-stop`,
        request: makeRequest(),
        cwd: "/test/project",
        emit: (event) => emitted.push(event),
        transportFactory: () => transport,
      });
      await waitForAsyncEvents();

      expect(emitted.some((event) => event.type === "completed")).toBe(false);
      expect(emitted.find((event) => event.type === "failed")).toMatchObject({
        type: "failed",
        error: `Kimi Code ended the run unexpectedly (stop reason: ${preservedReason}).`,
      });
    });
  }

  for (const stopReason of ["max_tokens", "max_turn_requests"] as const) {
    it(`completes the run when Kimi ACP stops at ${stopReason} with streamed text`, async () => {
      const emitted: ChatRunEvent[] = [];
      const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
        if (message.method === "initialize") {
          respondAcp(fakeTransport, message, { protocolVersion: 1 });
          return;
        }
        if (message.method === "session/new") {
          respondAcp(fakeTransport, message, { sessionId: `session-${stopReason}` });
          return;
        }
        if (message.method !== "session/prompt") return;

        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: `session-${stopReason}`,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Truncated answer" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason });
      });

      startKimiAcpChatRun({
        runId: `run-kimi-${stopReason}`,
        request: makeRequest(),
        cwd: "/test/project",
        emit: (event) => emitted.push(event),
        transportFactory: () => transport,
        bridgeFactory: async () => null,
      });
      await waitForAsyncEvents();

      expect(emitted.find((event) => event.type === "failed")).toBeUndefined();
      expect(emitted.find((event) => event.type === "completed")).toMatchObject({
        type: "completed",
        text: "Truncated answer",
      });
    });
  }

  it("surfaces the provider error from the Kimi session log when ACP returns an empty end_turn", async () => {
    const emitted: ChatRunEvent[] = [];
    const sessionsRoot = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-provider-error-"));
    const sessionDir = path.join(sessionsRoot, "wd-project", "session-provider-error");
    const logPath = path.join(sessionDir, "logs", "kimi-code.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(
      path.join(path.dirname(sessionsRoot), "session_index.jsonl"),
      `${JSON.stringify({ sessionId: "session-provider-error", sessionDir })}\n`,
    );
    await writeFile(logPath, "");

    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-provider-error" });
        return;
      }
      if (message.method === "session/prompt") {
        queueMicrotask(async () => {
          await appendFile(
            logPath,
            `${new Date().toISOString()} WARN  llm request failed  turnStep=0.1 attempt=1/10 model=k3 errorName=APIStatusError errorMessage="403 You've reached your usage limit for this billing cycle. Your quota will be refreshed in the next cycle." statusCode=403\n`,
          );
          respondAcp(fakeTransport, message, { stopReason: "end_turn" });
        });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-provider-error",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      kimiSessionsRoot: sessionsRoot,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      error:
        "Kimi Code provider error (HTTP 403): You've reached your usage limit for this billing cycle. Your quota will be refreshed in the next cycle.",
    });
  });

  it("stops the run when Kimi ACP returns cancelled", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-cancelled" });
        return;
      }
      if (message.method === "session/prompt") {
        respondAcp(fakeTransport, message, { stopReason: "cancelled" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-cancelled",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(emitted.filter((event) => event.type === "stopped")).toHaveLength(1);
    expect(emitted.some((event) => event.type === "completed" || event.type === "failed")).toBe(
      false,
    );
  });

  it("closes Carrent Bridge when a Kimi ACP run is stopped", async () => {
    const emitted: ChatRunEvent[] = [];
    const bridge = createFakeCarrentBridgeFactory();
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        return;
      }

      if (message.method === "session/cancel" && promptRequest) {
        respondAcp(fakeTransport, promptRequest, { stopReason: "cancelled" });
      }
    });

    const handle = startKimiAcpChatRun({
      runId: "run-kimi-bridge-stop",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
    });

    await waitForAsyncEvents();
    handle.stop();
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "stopped")).toMatchObject({
      type: "stopped",
      runId: "run-kimi-bridge-stop",
    });
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("cancels only running timeline items before publishing stopped", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-cancel-timeline" });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        for (const update of [
          {
            sessionUpdate: "tool_call",
            toolCallId: "completed-tool",
            title: "Read",
            status: "completed",
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "failed-tool",
            title: "Bash",
            status: "failed",
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "cancelled-tool",
            title: "Search",
            status: "cancelled",
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "pending-tool",
            title: "Read",
            status: "pending",
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "running-tool",
            title: "Write",
            status: "in_progress",
          },
          {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Still working" },
          },
        ]) {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "session-cancel-timeline", update },
          });
        }
        return;
      }
      if (message.method === "session/cancel" && promptRequest) {
        respondAcp(fakeTransport, promptRequest, { stopReason: "cancelled" });
      }
    });

    const handle = startKimiAcpChatRun({
      runId: "run-kimi-cancel-timeline",
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();
    handle.stop();
    await waitForAsyncEvents();

    const timeline = emitted.filter(
      (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
        event.type === "kimi-timeline",
    );
    const finalTools = new Map(
      timeline
        .filter((event) => event.item.type === "tool")
        .map((event) => [event.item.type === "tool" ? event.item.toolCallId : "", event.item]),
    );
    expect(finalTools.get("completed-tool")).toMatchObject({ status: "completed" });
    expect(finalTools.get("failed-tool")).toMatchObject({ status: "failed" });
    expect(finalTools.get("cancelled-tool")).toMatchObject({ status: "cancelled" });
    expect(finalTools.get("pending-tool")).toMatchObject({ status: "pending" });
    expect(finalTools.get("running-tool")).toMatchObject({ status: "cancelled" });
    expect(timeline.at(-1)?.item).toMatchObject({
      type: "thinking",
      content: "Still working",
      status: "cancelled",
    });
    expect(emitted.at(-1)).toMatchObject({ type: "stopped" });
  });

  it("closes Carrent Bridge if stop happens before bridge startup settles", async () => {
    const emitted: ChatRunEvent[] = [];
    let resolveBridge!: (handle: CarrentBridgeHandle & { closed: boolean }) => void;
    const bridgeStarted = new Promise<CarrentBridgeHandle & { closed: boolean }>((resolve) => {
      resolveBridge = resolve;
    });
    const bridgeHandle: CarrentBridgeHandle & { closed: boolean } = {
      closed: false,
      mcpServer: {
        id: "carrent_bridge",
        name: "carrent_bridge",
        type: "http",
        url: "http://127.0.0.1/pending/mcp?token=test",
        headers: [],
      },
      async close() {
        bridgeHandle.closed = true;
      },
    };
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
      }
    });

    const handle = startKimiAcpChatRun({
      runId: "run-kimi-bridge-pending-stop",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => bridgeStarted,
    });

    await waitForAsyncEvents();
    handle.stop();
    resolveBridge(bridgeHandle);
    await waitForAsyncEvents();

    expect(emitted).toEqual([
      {
        type: "stopped",
        runId: "run-kimi-bridge-pending-stop",
        writtenFiles: [],
      },
    ]);
    expect(bridgeHandle.closed).toBe(true);
    expect(transport.sent.map((message) => message.method)).toEqual(["initialize"]);
  });

  it("fails clearly when Carrent Bridge startup fails before opening a session", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-bridge-start-fail",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => {
        throw new Error("bridge failed");
      },
    });

    await waitForAsyncEvents();

    expect(transport.sent.map((message) => message.method)).toEqual(["initialize"]);
    expect(emitted).toEqual([
      {
        type: "failed",
        runId: "run-kimi-bridge-start-fail",
        error: "bridge failed",
        writtenFiles: [],
      },
    ]);
  });

  it("omits transcript when resuming an existing Kimi ACP session", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        respondAcp(fakeTransport, message, { configOptions: [] });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-resumed",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Resumed" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-resume-no-transcript",
      request: makeRequest({
        runtimeId: "kimi",
        message: "Follow up",
        transcript: [{ role: "user" as const, content: "Earlier" }],
      }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      resumeSessionId: "session-resumed",
    });

    await waitForAsyncEvents();

    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    const prompt = (promptRequest!.params as { prompt: Array<{ text: string }> }).prompt;
    expect(prompt).toHaveLength(1);
    expect(prompt[0].text).toBe("Follow up");
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Resumed",
    });
  });

  it("fails visibly without replaying the prompt when session resume fails", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "Session not found" },
        });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-failed-resume-transcript",
      request: makeRequest({
        runtimeId: "kimi",
        message: "Follow up",
        transcript: [
          { role: "user" as const, content: "First" },
          { role: "assistant" as const, content: "First answer" },
        ],
      }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      resumeSessionId: "stale-session",
    });

    await waitForAsyncEvents();

    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/resume",
    ]);
    expect(emitted.find((event) => event.type === "completed")).toBeUndefined();
    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      runtimeSessionRecovery: { runtimeId: "kimi", threadId: "thread-1" },
    });
  });

  it("shows a native Plan Review and returns control to the conversation", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, {
          sessionId: "session-plan",
          configOptions: [
            {
              id: "mode",
              currentValue: "default",
              options: [
                { value: "default", name: "Default" },
                { value: "plan", name: "Plan" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/set_config_option") {
        respondAcp(fakeTransport, message, {});
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-plan",
            update: {
              sessionUpdate: "config_option_update",
              configOptions: [{ id: "mode", currentValue: "plan", options: [] }],
            },
          },
        });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        queueMicrotask(() => {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            id: "permission-plan",
            method: "session/request_permission",
            params: {
              sessionId: "session-plan",
              options: [
                { optionId: "plan_opt_0", name: "Approach A", kind: "allow_once" },
                { optionId: "plan_opt_1", name: "Approach B", kind: "allow_once" },
                { optionId: "plan_revise", name: "Revise", kind: "reject_once" },
                {
                  optionId: "plan_reject_and_exit",
                  name: "Reject and Exit",
                  kind: "reject_once",
                },
              ],
              toolCall: {
                toolCallId: "tool-exit-plan",
                title: "ExitPlanMode",
                content: [
                  {
                    type: "content",
                    content: { type: "text", text: "Requesting approval to exit Plan mode" },
                  },
                  {
                    type: "content",
                    content: {
                      type: "text",
                      text: "Plan saved to: /Users/test/.kimi-code/plan.md\n\n# Plan\n\n- Implement it",
                    },
                  },
                ],
              },
            },
          });
        });
        return;
      }

      if (message.id === "permission-plan" && "result" in message) {
        queueMicrotask(() => {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-plan",
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-exit-plan",
                title: "ExitPlanMode",
                status: "completed",
                rawOutput: "Plan mode deactivated. All tools are now available.",
              },
            },
          });
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-plan",
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "Waiting for conversation" },
              },
            },
          });
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-plan",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "The plan was rejected." },
              },
            },
          });
          if (promptRequest) {
            respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
          }
        });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-plan-review",
      request: makeRequest({ planMode: true, message: "Implement the feature" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(
      transport.sent.find((message) => message.method === "session/set_config_option"),
    ).toMatchObject({
      params: { sessionId: "session-plan", configId: "mode", value: "plan" },
    });
    const permission = emitted.find(
      (event): event is Extract<ChatRunEvent, { type: "permission-requested" }> =>
        event.type === "permission-requested",
    )!;
    expect(permission.permission.planReview).toEqual({ content: "# Plan\n\n- Implement it" });
    expect(permission.permission.options.map((option) => option.optionId)).toEqual([
      "plan_opt_0",
      "plan_opt_1",
      "plan_revise",
      "plan_reject_and_exit",
    ]);

    expect(transport.sent.find((message) => message.id === "permission-plan")?.result).toEqual({
      outcome: { outcome: "selected", optionId: "plan_reject_and_exit" },
    });
    expect(emitted.find((event) => event.type === "permission-resolved")).toMatchObject({
      type: "permission-resolved",
      optionId: "plan_reject_and_exit",
      optionName: "Reject and Exit",
      optionKind: "reject_once",
    });
    expect(
      emitted.filter((event) => event.type === "plan-mode-changed").map((event) => event.enabled),
    ).toEqual([true, false]);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "",
    });
    expect(emitted.some((event) => event.type === "delta")).toBe(false);
    expect(
      emitted
        .filter(
          (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
            event.type === "kimi-timeline",
        )
        .map((event) => event.item),
    ).toEqual([
      {
        type: "tool",
        id: "kimi-run-kimi-plan-review-tool-item-0",
        order: 0,
        toolCallId: "tool-exit-plan",
        title: "ExitPlanMode",
        kind: "",
        command: "",
        filePath: "",
        input: "",
        output: "Plan mode deactivated. All tools are now available.",
        error: "",
        status: "completed",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-plan-review-thinking-1",
        order: 1,
        content: "Waiting for conversation",
        status: "running",
      },
      {
        type: "thinking",
        id: "kimi-run-kimi-plan-review-thinking-1",
        order: 1,
        content: "Waiting for conversation",
        status: "completed",
      },
    ]);
  });

  it("syncs Kimi-initiated EnterPlanMode tool results", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-enter-plan" });
        return;
      }
      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-enter-plan",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-enter-plan",
              title: "EnterPlanMode",
              status: "completed",
              rawOutput: "Plan mode is now active. Focus on planning.",
            },
          },
        });
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-enter-plan",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Planning" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-enter-plan",
      request: makeRequest(),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "plan-mode-changed")).toMatchObject({
      type: "plan-mode-changed",
      enabled: true,
    });
  });

  it("reads and writes only the current session Plan file", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-plan-project-"));
    const sessionsRoot = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-sessions-"));
    const sessionId = "session-files";
    const planPath = path.join(
      sessionsRoot,
      "workspace-key",
      sessionId,
      "agents",
      "main",
      "plans",
      "feature.md",
    );
    await mkdir(path.dirname(planPath), { recursive: true });
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-plan",
          method: "fs/write_text_file",
          params: { sessionId, path: planPath, content: "# Plan\n\n- Step" },
        });
        return;
      }
      if (message.id === "write-plan" && "result" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-plan",
          method: "fs/read_text_file",
          params: { sessionId, path: planPath },
        });
        return;
      }
      if (message.id === "read-plan" && "result" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Plan saved" },
            },
          },
        });
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-plan-files",
      request: makeRequest({
        context: {
          kind: "project",
          workspaceId: "workspace-1",
          projectId: "p1",
          workingDirectory: projectDir,
        },
      }),
      cwd: projectDir,
      emit: () => {},
      transportFactory: () => transport,
      kimiSessionsRoot: sessionsRoot,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      (transport.sent[0].params as { clientCapabilities?: unknown }).clientCapabilities,
    ).toMatchObject({ fs: { readTextFile: true, writeTextFile: true } });
    expect(await readFile(planPath, "utf8")).toBe("# Plan\n\n- Step");
    expect(transport.sent.find((message) => message.id === "read-plan")?.result).toEqual({
      content: "# Plan\n\n- Step",
    });
  });

  it("reports workspace files written during the run on the completed event", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-written-files-"));
    const workspaceFile = path.join(projectDir, "notes", "result.md");
    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-written" });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-workspace",
          method: "fs/write_text_file",
          params: { sessionId: "session-written", path: workspaceFile, content: "# Result" },
        });
        return;
      }
      if (message.id === "write-workspace" && "result" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-written",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Wrote it" },
            },
          },
        });
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-written-files",
      request: makeRequest({
        context: {
          kind: "project",
          workspaceId: "workspace-1",
          projectId: "p1",
          workingDirectory: projectDir,
        },
      }),
      cwd: projectDir,
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await readFile(workspaceFile, "utf8")).toBe("# Result");
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      writtenFiles: ["notes/result.md"],
    });
  });

  it("reports an empty writtenFiles list for read-only runs", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-readonly" });
        return;
      }
      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-readonly",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Done" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-readonly",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Done",
      writtenFiles: [],
    });
  });

  it("rejects other-session and symlinked Plan file writes", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-plan-project-"));
    const sessionsRoot = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-sessions-"));
    const sessionId = "session-current";
    const otherPlanPath = path.join(
      sessionsRoot,
      "workspace-key",
      "session-other",
      "agents",
      "main",
      "plans",
      "other.md",
    );
    const currentPlanPath = path.join(
      sessionsRoot,
      "workspace-key",
      sessionId,
      "agents",
      "main",
      "plans",
      "current.md",
    );
    const outsidePath = path.join(projectDir, "outside.md");
    await mkdir(path.dirname(currentPlanPath), { recursive: true });
    await writeFile(outsidePath, "unchanged");
    await symlink(outsidePath, currentPlanPath);
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-other-session",
          method: "fs/write_text_file",
          params: { sessionId, path: otherPlanPath, content: "blocked" },
        });
        return;
      }
      if (message.id === "write-other-session" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-symlink",
          method: "fs/write_text_file",
          params: { sessionId, path: currentPlanPath, content: "blocked" },
        });
        return;
      }
      if (message.id === "write-symlink" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Blocked" },
            },
          },
        });
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-plan-file-boundary",
      request: makeRequest({
        context: {
          kind: "project",
          workspaceId: "workspace-1",
          projectId: "p1",
          workingDirectory: projectDir,
        },
      }),
      cwd: projectDir,
      emit: () => {},
      transportFactory: () => transport,
      kimiSessionsRoot: sessionsRoot,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      transport.sent.find((message) => message.id === "write-other-session")?.error,
    ).toMatchObject({
      code: -32000,
    });
    expect(transport.sent.find((message) => message.id === "write-symlink")?.error).toMatchObject({
      code: -32000,
    });
    expect(await readFile(outsidePath, "utf8")).toBe("unchanged");
  });

  it("reads only the exact current File Attachment and names it in Agent Activity", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-attach-project-"));
    const attachmentsDir = path.join(projectDir, ".carrent", "attachments");
    await mkdir(attachmentsDir, { recursive: true });
    const configPath = path.join(attachmentsDir, "config.json");
    const siblingPath = path.join(attachmentsDir, "sibling.txt");
    const outsidePath = path.join(projectDir, "outside.txt");
    const symlinkPath = path.join(attachmentsDir, "link.txt");
    await writeFile(configPath, '{"ok":true}');
    await writeFile(siblingPath, "sibling");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, symlinkPath);

    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-config",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: configPath },
        });
        return;
      }
      if (message.id === "read-config" && "result" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-sibling",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: siblingPath },
        });
        return;
      }
      if (message.id === "read-sibling" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-config",
          method: "fs/write_text_file",
          params: { sessionId: "session-1", path: configPath, content: "hacked" },
        });
        return;
      }
      if (message.id === "write-config" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-symlink",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: symlinkPath },
        });
        return;
      }
      if (message.id === "read-symlink" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Done" },
            },
          },
        });
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-attachment-boundary",
      request: makeRequest({
        context: {
          kind: "project",
          workspaceId: "workspace-1",
          projectId: "p1",
          workingDirectory: projectDir,
        },
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "config.json",
            mimeType: "text/plain",
            size: 12,
            storageKey: "a1.json",
            localPath: configPath,
          },
        ],
      }),
      cwd: projectDir,
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      attachmentStoreRoot: attachmentsDir,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(transport.sent.find((message) => message.id === "read-config")?.result).toEqual({
      content: '{"ok":true}',
    });
    expect(transport.sent.find((message) => message.id === "read-sibling")?.error).toMatchObject({
      code: -32000,
    });
    expect(transport.sent.find((message) => message.id === "write-config")?.error).toMatchObject({
      code: -32000,
    });
    expect(transport.sent.find((message) => message.id === "read-symlink")?.error).toMatchObject({
      code: -32000,
    });
    expect(await readFile(configPath, "utf8")).toBe('{"ok":true}');

    const readEvent = emitted.find(
      (event) => event.type === "reasoning" && event.reasoning.content.startsWith("Read "),
    );
    expect(readEvent && readEvent.type === "reasoning" && readEvent.reasoning.content).toBe(
      "Read config.json",
    );
    expect(JSON.stringify(emitted)).not.toContain(attachmentsDir);

    const prompt = (promptRequest as Record<string, unknown> | null)?.params as {
      prompt?: Array<Record<string, unknown>>;
    };
    expect(prompt.prompt?.[1]).toEqual({
      type: "resource_link",
      uri: `file://${configPath}`,
      name: "config.json",
      mimeType: "text/plain",
      size: 12,
    });
  });

  it("protects remembered attachment paths when the current request has no attachments", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-attach-history-"));
    const attachmentsDir = path.join(projectDir, ".carrent", "attachments");
    const oldAttachmentPath = path.join(attachmentsDir, "old.txt");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(oldAttachmentPath, "history snapshot");

    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-old-attachment",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: oldAttachmentPath },
        });
        return;
      }
      if (message.id === "read-old-attachment" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-old-attachment",
          method: "fs/write_text_file",
          params: { sessionId: "session-1", path: oldAttachmentPath, content: "changed" },
        });
        return;
      }
      if (message.id === "write-old-attachment" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Done" },
            },
          },
        });
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-attachment-history-boundary",
      request: makeRequest({
        context: {
          kind: "project",
          workspaceId: "workspace-1",
          projectId: "p1",
          workingDirectory: projectDir,
        },
        attachments: [],
      }),
      cwd: projectDir,
      emit: () => {},
      transportFactory: () => transport,
      attachmentStoreRoot: attachmentsDir,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      transport.sent.find((message) => message.id === "read-old-attachment")?.error,
    ).toMatchObject({
      code: -32000,
    });
    expect(
      transport.sent.find((message) => message.id === "write-old-attachment")?.error,
    ).toMatchObject({
      code: -32000,
    });
    expect(await readFile(oldAttachmentPath, "utf8")).toBe("history snapshot");
  });

  it("fails the run when a stored File Attachment is missing", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-missing-project-"));
    const missingPath = path.join(projectDir, "gone.txt");

    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-attachment-missing",
      request: makeRequest({
        context: {
          kind: "project",
          workspaceId: "workspace-1",
          projectId: "p1",
          workingDirectory: projectDir,
        },
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "gone.txt",
            mimeType: "text/plain",
            size: 10,
            storageKey: "a1.txt",
            localPath: missingPath,
          },
        ],
      }),
      cwd: projectDir,
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const failed = emitted.find((event) => event.type === "failed");
    expect(failed && failed.type === "failed" && failed.error).toContain(
      "Attachment is unavailable: gone.txt",
    );
    expect(transport.sent.map((message) => message.method)).not.toContain("session/prompt");
  });
});

describe("Kimi tool timeline", () => {
  type ToolItem = Extract<KimiTimelineItem, { type: "tool" }>;

  function toolItemsFrom(emitted: ChatRunEvent[]): ToolItem[] {
    return emitted
      .filter(
        (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
          event.type === "kimi-timeline" && event.item.type === "tool",
      )
      .map((event) => event.item as ToolItem);
  }

  async function runWithUpdates(
    runId: string,
    updates: Array<Record<string, unknown>>,
    options: { promptResponse?: unknown } = {},
  ): Promise<{ emitted: ChatRunEvent[]; transport: FakeKimiAcpTransport }> {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: `session-${runId}` });
        return;
      }
      if (message.method !== "session/prompt") return;

      for (const update of updates) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: `session-${runId}`, update },
        });
      }
      respondAcp(fakeTransport, message, options.promptResponse ?? { stopReason: "end_turn" });
    });

    startKimiAcpChatRun({
      runId,
      request: makeRequest(),
      cwd: "/test/project",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();
    return { emitted, transport };
  }

  it("creates one tool item at first-seen order and updates it in place without moving it", async () => {
    const { emitted } = await runWithUpdates("run-tool-stable-order", [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-stable",
        title: "Read",
        kind: "read",
        status: "in_progress",
        rawInput: { path: "src/a.ts" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-stable",
        status: "completed",
        rawOutput: "file contents",
      },
    ]);

    const items = toolItemsFrom(emitted);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.order)).toEqual([0, 0]);
    expect(items.map((item) => item.id)).toEqual([items[0]!.id, items[0]!.id]);
    expect(items[0]).toMatchObject({ status: "running", title: "Read" });
    expect(items[1]).toMatchObject({
      status: "completed",
      output: "file contents",
      title: "Read",
    });
    // A later thinking chunk does not let the tool jump to the end of the
    // timeline: its order stays at its first-seen position.
    const orderedKimiItems = emitted
      .filter((event) => event.type === "kimi-timeline")
      .map((event) => (event as { item: KimiTimelineItem }).item);
    expect(orderedKimiItems.every((item) => item.order === 0)).toBe(true);
  });

  it("completes a temporary item when an update arrives before its start", async () => {
    const { emitted } = await runWithUpdates("run-tool-update-first", [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-early",
        status: "completed",
        title: "Bash",
        kind: "execute",
        rawOutput: "done",
      },
    ]);

    const items = toolItemsFrom(emitted);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      toolCallId: "tool-early",
      title: "Bash",
      kind: "execute",
      output: "done",
      status: "completed",
    });
  });

  it("keeps concurrent tool ids independent so neither overwrites the other", async () => {
    const { emitted } = await runWithUpdates("run-tool-parallel", [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-a",
        title: "Read",
        kind: "read",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-b",
        title: "Bash",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "ls" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-a",
        status: "completed",
        rawOutput: "a-out",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-b",
        status: "failed",
        rawOutput: "boom",
      },
    ]);

    const finalById = new Map(toolItemsFrom(emitted).map((item) => [item.toolCallId, item]));
    expect(finalById.get("tool-a")).toMatchObject({ output: "a-out", status: "completed" });
    expect(finalById.get("tool-b")).toMatchObject({ output: "boom", status: "failed" });
    // Each id occupies its own first-seen order slot.
    const orders = new Map(toolItemsFrom(emitted).map((item) => [item.toolCallId, item.order]));
    expect(orders.get("tool-a")).not.toBe(orders.get("tool-b"));
  });

  it("gives missing toolCallId tools unique Run-scoped ids instead of a shared fallback", async () => {
    const { emitted } = await runWithUpdates("run-tool-missing-ids", [
      {
        sessionUpdate: "tool_call",
        title: "Read",
        kind: "read",
        status: "completed",
      },
      {
        sessionUpdate: "tool_call_update",
        title: "Bash",
        kind: "execute",
        status: "completed",
        rawInput: { command: "pwd" },
      },
    ]);

    const items = toolItemsFrom(emitted);
    const ids = new Set(items.map((item) => item.id));
    const toolCallIds = new Set(items.map((item) => item.toolCallId));
    // Two distinct missing-id tools never collapse onto one item.
    expect(ids.size).toBe(2);
    expect(toolCallIds.size).toBe(2);
    // No fixed fallback id is reused.
    expect([...toolCallIds].every((id) => id !== "kimi-tool")).toBe(true);
    expect([...toolCallIds].every((id) => id.startsWith("kimi-run-tool-missing-ids-tool-"))).toBe(
      true,
    );
  });

  it("routes shell and generic tools through the same timeline contract while keeping shell command details", async () => {
    const { emitted } = await runWithUpdates("run-tool-shell-and-generic", [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-shell",
        title: "Bash",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "git status" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-generic",
        title: "Search",
        kind: "search",
        status: "completed",
      },
    ]);

    const finalById = new Map(toolItemsFrom(emitted).map((item) => [item.toolCallId, item]));
    // Both use the same item shape; the shell command is retained as a derived
    // field rather than deciding whether the call belongs to the timeline.
    expect(finalById.get("tool-shell")).toMatchObject({
      kind: "execute",
      command: "git status",
    });
    expect(finalById.get("tool-generic")).toMatchObject({ kind: "search", command: "" });
  });

  it("maps the normal ACP tool states onto pending, running, completed, and failed", async () => {
    const { emitted: pendingEmitted } = await runWithUpdates("run-tool-pending", [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-pending",
        title: "Read",
        kind: "read",
        status: "pending",
      },
    ]);
    expect(toolItemsFrom(pendingEmitted)[0]?.status).toBe("pending");

    const { emitted } = await runWithUpdates("run-tool-state-map", [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-progress",
        title: "Read",
        kind: "read",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-progress",
        status: "completed",
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-failed",
        title: "Bash",
        kind: "execute",
        status: "failed",
        rawOutput: "nope",
      },
    ]);
    const finalById = new Map(toolItemsFrom(emitted).map((item) => [item.toolCallId, item]));
    expect(finalById.get("tool-progress")?.status).toBe("completed");
    expect(finalById.get("tool-failed")?.status).toBe("failed");
    // No tool item is ever classified as a Thinking item.
    expect(
      emitted.every(
        (event) =>
          !(event.type === "kimi-timeline" && event.item.type === "thinking") ||
          event.item.content !== "Bash",
      ),
    ).toBe(true);
  });

  it("retains input, output, title, kind, status, and error in the tool item", async () => {
    const { emitted } = await runWithUpdates("run-tool-rich-fields", [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-rich",
        title: "Write",
        kind: "write",
        status: "in_progress",
        rawInput: { path: "src/a.ts", content: "export const x = 1;" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-rich",
        status: "failed",
        rawOutput: "permission denied",
      },
    ]);

    const items = toolItemsFrom(emitted);
    const failed = items[items.length - 1]!;
    expect(failed).toMatchObject({
      title: "Write",
      kind: "write",
      filePath: "src/a.ts",
      output: "permission denied",
      error: "permission denied",
      status: "failed",
    });
    // The tool input snapshot captures the raw input payload.
    expect(failed.input).toContain("src/a.ts");
  });

  it("ends the current Thinking phase on a tool update while preserving the assigned order", async () => {
    const { emitted } = await runWithUpdates("run-tool-ends-thinking", [
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Thinking before tool" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-after-thinking",
        title: "Read",
        kind: "read",
        status: "in_progress",
      },
    ]);

    const timeline = emitted
      .filter((event) => event.type === "kimi-timeline")
      .map((event) => (event as { item: KimiTimelineItem }).item);
    // Thinking phase is closed (completed) before the tool item appears.
    const thinkingCompletedIndex = timeline.findIndex(
      (item) => item.type === "thinking" && item.status === "completed",
    );
    const toolIndex = timeline.findIndex((item) => item.type === "tool");
    expect(thinkingCompletedIndex >= 0).toBe(true);
    expect(toolIndex).toBeGreaterThan(thinkingCompletedIndex);
    // Thinking and tool retain their distinct first-seen orders.
    const thinking = timeline.find((item) => item.type === "thinking");
    const tool = timeline.find((item) => item.type === "tool");
    expect(thinking && tool && thinking.order < tool.order).toBe(true);
  });

  for (const settledStatus of ["completed", "failed", "cancelled"] as const) {
    it(`does not regress a ${settledStatus} tool back to running on a later ordinary update`, async () => {
      const { emitted } = await runWithUpdates(`run-tool-no-regression-${settledStatus}`, [
        {
          sessionUpdate: "tool_call",
          toolCallId: "tool-settled",
          title: "Read",
          kind: "read",
          status: settledStatus,
          rawOutput: "settled output",
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-settled",
          status: "in_progress",
        },
      ]);

      const items = toolItemsFrom(emitted);
      expect(items[items.length - 1]!.status).toBe(settledStatus);
    });
  }
});

describe("Kimi subagent tasks", () => {
  function runSubagentSequence(updates: Array<Record<string, unknown>>) {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-subagent" });
        return;
      }
      if (message.method === "session/prompt") {
        for (const update of updates) {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "session-subagent", update },
          });
        }
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-subagent",
      request: makeRequest(),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });

    return emitted;
  }

  function subagentEvents(emitted: ChatRunEvent[]) {
    return emitted.filter(
      (event): event is Extract<ChatRunEvent, { type: "subagent-task" }> =>
        event.type === "subagent-task",
    );
  }

  const agentStart = {
    sessionUpdate: "tool_call",
    toolCallId: "0:tool_agent",
    title: "Launching coder agent: Implement persistence",
    kind: "other",
    status: "in_progress",
    rawInput: {
      subagent_type: "coder",
      description: "Implement persistence",
      prompt: "Implement step 1 and report the result",
    },
  };

  it("emits running then completed for a single Agent call with object rawOutput", async () => {
    const emitted = runSubagentSequence([
      agentStart,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_agent",
        status: "completed",
        rawOutput: {
          output:
            "agent_id: agent-0\nactual_subagent_type: coder\nstatus: completed\n\n[summary]\nImplemented persistence and tests.",
        },
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].task).toMatchObject({
      id: "0:tool_agent",
      runtimeId: "kimi",
      source: "agent",
      agentType: "coder",
      description: "Implement persistence",
      prompt: "Implement step 1 and report the result",
      background: false,
      status: "running",
    });
    expect(tasks[0].task.finishedAt).toBeUndefined();
    expect(tasks[1].task).toMatchObject({
      id: "0:tool_agent",
      runtimeAgentId: "agent-0",
      agentType: "coder",
      status: "completed",
      summary: "Implemented persistence and tests.",
    });
    expect(tasks[1].task.startedAt).toBe(tasks[0].task.startedAt);
    expect(tasks[1].task.finishedAt).toBeGreaterThan(tasks[1].task.startedAt - 1);

    // The subagent-spawning tool is unified into the Kimi tool timeline
    // alongside the dedicated subagent-task events.
    const agentToolItems = emitted
      .filter(
        (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
          event.type === "kimi-timeline" &&
          event.item.type === "tool" &&
          event.item.toolCallId === "0:tool_agent",
      )
      .map((event) => event.item as Extract<(typeof event)["item"], { type: "tool" }>);
    expect(agentToolItems.map((item) => item.status)).toEqual(["running", "completed"]);
    expect(new Set(agentToolItems.map((item) => item.order)).size).toBe(1);
  });

  it("recognizes a resume start without subagent_type", async () => {
    const emitted = runSubagentSequence([
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_resume",
        title: "Launching coder agent: Continue persistence",
        kind: "other",
        status: "in_progress",
        rawInput: {
          description: "Continue persistence",
          prompt: "Keep going from where you stopped",
          resume: "agent-0",
        },
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task).toMatchObject({
      id: "0:tool_resume",
      source: "agent",
      description: "Continue persistence",
      prompt: "Keep going from where you stopped",
      status: "running",
    });
    expect(tasks[0].task.agentType).toBeUndefined();
  });

  it("marks the task failed when the Agent result fails", async () => {
    const emitted = runSubagentSequence([
      agentStart,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_agent",
        status: "failed",
        rawOutput: "agent_id: agent-0\nstatus: failed\n\n[summary]\nSubagent hit an error.",
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    expect(tasks[1].task.status).toBe("failed");
    expect(tasks[1].task.summary).toBe("Subagent hit an error.");
    expect(tasks[1].task.finishedAt).toBeDefined();
  });

  it("marks a still-running background result as detached", async () => {
    const emitted = runSubagentSequence([
      {
        ...agentStart,
        toolCallId: "0:tool_background",
        rawInput: {
          ...agentStart.rawInput,
          run_in_background: true,
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_background",
        status: "completed",
        rawOutput: {
          output: "agent_id: agent-2\nstatus: running\n\n[summary]\nStill working in background.",
        },
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].task.background).toBe(true);
    expect(tasks[1].task).toMatchObject({
      status: "detached",
      runtimeAgentId: "agent-2",
    });
    expect(tasks[1].task.finishedAt).toBeDefined();
  });

  it("records the aggregate agent count for an AgentSwarm call", async () => {
    const emitted = runSubagentSequence([
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_swarm",
        title: "Launching agent swarm: Review modules",
        kind: "other",
        status: "in_progress",
        rawInput: {
          description: "Review modules",
          subagent_type: "explore",
          prompt_template: "Review {{item}}",
          items: ["src/a.ts", "src/b.ts", "src/c.ts"],
          resume_agent_ids: { "agent-1": "resume a", "agent-2": "resume b" },
        },
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task).toMatchObject({
      id: "0:tool_swarm",
      source: "agent-swarm",
      agentType: "explore",
      agentCount: 5,
      description: "Review modules",
      status: "running",
    });
  });

  it("preserves one id and the original start time across repeated updates", async () => {
    const emitted = runSubagentSequence([
      agentStart,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_agent",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_agent",
        status: "completed",
        rawOutput: "agent_id: agent-0\nstatus: completed\n\n[summary]\nDone.",
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks.map((event) => event.task.status)).toEqual(["running", "running", "completed"]);
    expect(new Set(tasks.map((event) => event.task.id)).size).toBe(1);
    expect(tasks[1].task.startedAt).toBe(tasks[0].task.startedAt);
    expect(tasks[2].task.startedAt).toBe(tasks[0].task.startedAt);
    expect(tasks[2].task.description).toBe("Implement persistence");
  });

  it("falls back to generic reasoning only for malformed Agent-like input", async () => {
    const emitted = runSubagentSequence([
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_malformed",
        title: "Launching coder agent: Missing description",
        kind: "other",
        status: "in_progress",
        rawInput: {
          subagent_type: "coder",
          prompt: 42,
        },
      },
    ]);
    await waitForAsyncEvents();

    expect(subagentEvents(emitted)).toHaveLength(0);
    // A malformed Agent-like call still surfaces as a unified tool timeline
    // item even though no subagent task is produced.
    const malformedTool = emitted.find(
      (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
        event.type === "kimi-timeline" &&
        event.item.type === "tool" &&
        event.item.toolCallId === "0:tool_malformed",
    );
    expect(malformedTool?.item).toMatchObject({
      title: "Launching coder agent: Missing description",
      status: "running",
    });
  });

  it("completes without a summary when the result text is malformed", async () => {
    const emitted = runSubagentSequence([
      agentStart,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_agent",
        status: "completed",
        rawOutput: "totally unstructured blob",
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Finished." },
      },
    ]);
    await waitForAsyncEvents();
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    expect(tasks[1].task.status).toBe("completed");
    expect(tasks[1].task.summary).toBeUndefined();
    expect(tasks[1].task.runtimeAgentId).toBeUndefined();
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Finished.",
    });
  });

  it("leaves ordinary tools without subagent tasks", async () => {
    const emitted = runSubagentSequence([
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_bash",
        title: "Bash",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "ls" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_bash",
        status: "completed",
        rawOutput: "file.txt",
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_read",
        title: "Read",
        kind: "read",
        status: "completed",
        rawInput: { path: "src/a.ts" },
      },
    ]);
    await waitForAsyncEvents();

    expect(subagentEvents(emitted)).toHaveLength(0);
    // Shell and generic tools share the same unified tool timeline contract.
    const toolItems = emitted
      .filter(
        (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
          event.type === "kimi-timeline" && event.item.type === "tool",
      )
      .map((event) => event.item as Extract<(typeof event)["item"], { type: "tool" }>);
    const bashFinal = [...toolItems].reverse().find((item) => item.toolCallId === "0:tool_bash");
    expect(bashFinal).toMatchObject({
      title: "Bash",
      kind: "execute",
      command: "ls",
      output: "file.txt",
      status: "completed",
    });
    const readFinal = toolItems.find((item) => item.toolCallId === "0:tool_read");
    expect(readFinal).toMatchObject({
      title: "Read",
      kind: "read",
      filePath: "src/a.ts",
      status: "completed",
    });
    // Bash starts as running before the completion update lands, and the start
    // and update share one first-seen order.
    const bashItems = toolItems.filter((item) => item.toolCallId === "0:tool_bash");
    expect(bashItems.map((item) => item.status)).toEqual(["running", "completed"]);
    expect(new Set(bashItems.map((item) => item.order)).size).toBe(1);
  });

  it("settles a background task as completed when its result completes", async () => {
    const emitted = runSubagentSequence([
      {
        ...agentStart,
        toolCallId: "0:tool_background",
        rawInput: {
          ...agentStart.rawInput,
          run_in_background: true,
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_background",
        status: "completed",
        rawOutput: {
          output: "agent_id: agent-2\nstatus: completed\n\n[summary]\nBackground work finished.",
        },
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    expect(tasks[1].task).toMatchObject({
      background: true,
      status: "completed",
      summary: "Background work finished.",
    });
    expect(tasks[1].task.finishedAt).toBeDefined();
  });

  it("detaches a background task when the result is unparseable", async () => {
    const emitted = runSubagentSequence([
      {
        ...agentStart,
        toolCallId: "0:tool_background",
        rawInput: {
          ...agentStart.rawInput,
          run_in_background: true,
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_background",
        status: "completed",
        rawOutput: "totally unstructured blob",
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    // Without a parsed completed result, completion cannot be confirmed.
    expect(tasks[1].task.status).toBe("detached");
    expect(tasks[1].task.summary).toBeUndefined();
    expect(tasks[1].task.finishedAt).toBeDefined();
  });

  it("detaches a background AgentSwarm whose result is never parsed", async () => {
    const emitted = runSubagentSequence([
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_swarm",
        title: "Launching agent swarm: Review modules",
        kind: "other",
        status: "in_progress",
        rawInput: {
          description: "Review modules",
          items: ["src/a.ts"],
          run_in_background: true,
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_swarm",
        status: "completed",
        rawOutput: "totally unstructured blob",
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    expect(tasks[1].task).toMatchObject({
      source: "agent-swarm",
      background: true,
      status: "detached",
    });
    expect(tasks[1].task.finishedAt).toBeDefined();
  });

  it("settles a foreground AgentSwarm as completed on the outer status", async () => {
    const emitted = runSubagentSequence([
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_swarm",
        title: "Launching agent swarm: Review modules",
        kind: "other",
        status: "in_progress",
        rawInput: {
          description: "Review modules",
          items: ["src/a.ts"],
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_swarm",
        status: "completed",
        rawOutput: "totally unstructured blob",
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    expect(tasks[1].task.status).toBe("completed");
    expect(tasks[1].task.finishedAt).toBeDefined();
  });

  it("omits agentCount when a swarm call has no items or resumes", async () => {
    const emitted = runSubagentSequence([
      {
        sessionUpdate: "tool_call",
        toolCallId: "0:tool_swarm",
        title: "Launching agent swarm: Review modules",
        kind: "other",
        status: "in_progress",
        rawInput: {
          description: "Review modules",
        },
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task.source).toBe("agent-swarm");
    expect(tasks[0].task.agentCount).toBeUndefined();
  });

  it("caps persisted description, prompt, and summary at 12,000 characters", async () => {
    const longText = "x".repeat(20_000);
    const emitted = runSubagentSequence([
      {
        ...agentStart,
        rawInput: {
          ...agentStart.rawInput,
          description: longText,
          prompt: longText,
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "0:tool_agent",
        status: "completed",
        rawOutput: `status: completed\n\n[summary]\n${longText}`,
      },
    ]);
    await waitForAsyncEvents();

    const tasks = subagentEvents(emitted);
    expect(tasks).toHaveLength(2);
    for (const text of [tasks[1].task.description, tasks[1].task.prompt, tasks[1].task.summary]) {
      expect(text).toBeDefined();
      expect(text!.length <= MAX_SUBAGENT_TASK_TEXT_LENGTH).toBe(true);
      expect(text!).toContain("[output truncated]");
    }
  });
});

describe("native ACP structured questions", () => {
  const askUserQuestionToolCall = {
    toolCallId: "tool-ask-user-question",
    title: "AskUserQuestion",
    kind: "other",
    status: "pending",
    rawInput: {
      questions: [
        {
          header: "Language",
          question: "Which language should the new module use?",
          options: [
            { label: "TypeScript", description: "Use TypeScript for the new module" },
            { label: "JavaScript" },
          ],
          multi_select: false,
        },
      ],
    },
  };

  const questionPermissionOptions = [
    { optionId: "opt_ts", name: "TypeScript", kind: "allow_once" },
    { optionId: "opt_js", name: "JavaScript", kind: "allow_once" },
    { optionId: "opt_dismiss", name: "Dismiss", kind: "reject_once" },
  ];

  function createQuestionTransport(questionParams: Record<string, unknown>) {
    return new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-question" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            id: "question-1",
            method: "session/request_permission",
            params: {
              sessionId: "session-question",
              ...questionParams,
            },
          });
        });
      }
    });
  }

  function startQuestionRun(
    transport: FakeKimiAcpTransport,
    emitted: ChatRunEvent[],
    runId = "run-kimi-question",
  ) {
    return startKimiAcpChatRun({
      runId,
      request: makeRequest(),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
  }

  it("classifies a native AskUserQuestion request as a structured question, not an Approval Request", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    expect(emitted.some((event) => event.type === "permission-requested")).toBe(false);
    const requested = emitted.find(
      (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
        event.type === "question-requested",
    )!;
    expect(requested).toBeDefined();
    expect(requested.question).toMatchObject({
      id: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      threadId: "thread-1",
      provider: "kimi",
      source: "native-acp",
      skipOptionId: "opt_dismiss",
    });
    expect(requested.question.questions).toEqual([
      {
        header: "Language",
        question: "Which language should the new module use?",
        options: [
          { optionId: "opt_ts", label: "TypeScript" },
          { optionId: "opt_js", label: "JavaScript" },
          { optionId: "opt_dismiss", label: "Dismiss" },
        ],
        multiSelect: false,
      },
    ]);
  });

  it("returns the selected upstream ACP option id when the question is submitted", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["opt_js"] }],
    });
    await waitForAsyncEvents();

    expect(transport.sent.find((message) => message.id === "question-1")?.result).toEqual({
      outcome: { outcome: "selected", optionId: "opt_js" },
    });
    expect(emitted.find((event) => event.type === "question-resolved")).toMatchObject({
      type: "question-resolved",
      runId: "run-kimi-question",
      questionId: "kimi-question-run-kimi-question-question-1",
      outcome: "answered",
      optionId: "opt_js",
      optionLabel: "JavaScript",
    });
  });

  it("skip selects the dismiss option Kimi forwarded without stopping the run", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "skip",
    });
    await waitForAsyncEvents();

    expect(transport.sent.find((message) => message.id === "question-1")?.result).toEqual({
      outcome: { outcome: "selected", optionId: "opt_dismiss" },
    });
    expect(emitted.find((event) => event.type === "question-resolved")).toMatchObject({
      type: "question-resolved",
      questionId: "kimi-question-run-kimi-question-question-1",
      outcome: "skipped",
      optionId: "opt_dismiss",
      optionLabel: "Dismiss",
    });
    expect(emitted.some((event) => event.type === "stopped")).toBe(false);
  });

  it("skip cancels the ACP request when Kimi forwarded no dismiss option", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions.filter((option) => option.kind !== "reject_once"),
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    const requested = emitted.find(
      (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
        event.type === "question-requested",
    )!;
    expect(requested.question.skipOptionId).toBeUndefined();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "skip",
    });
    await waitForAsyncEvents();

    expect(transport.sent.find((message) => message.id === "question-1")?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(emitted.find((event) => event.type === "question-resolved")).toMatchObject({
      type: "question-resolved",
      questionId: "kimi-question-run-kimi-question-question-1",
      outcome: "skipped",
    });
  });

  it("cancels and reports a question failure when the payload has no question text", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: {
        ...askUserQuestionToolCall,
        rawInput: { questions: [{ header: "Language", multi_select: false }] },
      },
    });

    startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    expect(emitted.some((event) => event.type === "question-requested")).toBe(false);
    expect(emitted.some((event) => event.type === "permission-requested")).toBe(false);
    expect(transport.sent.find((message) => message.id === "question-1")?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(emitted.find((event) => event.type === "question-failed")).toMatchObject({
      type: "question-failed",
      runId: "run-kimi-question",
      questionId: "kimi-question-run-kimi-question-question-1",
      error: "Kimi question request did not include a supported question.",
    });
    // The Run survives a malformed question payload.
    expect(emitted.some((event) => event.type === "failed")).toBe(false);
    expect(emitted.some((event) => event.type === "stopped")).toBe(false);
  });

  it("cancels and reports a question failure when the payload has no usable options", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: [{ optionId: "", name: "TypeScript", kind: "allow_once" }],
      toolCall: askUserQuestionToolCall,
    });

    startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    expect(emitted.some((event) => event.type === "question-requested")).toBe(false);
    expect(emitted.some((event) => event.type === "permission-requested")).toBe(false);
    expect(transport.sent.find((message) => message.id === "question-1")?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(emitted.find((event) => event.type === "question-failed")).toMatchObject({
      type: "question-failed",
      runId: "run-kimi-question",
      questionId: "kimi-question-run-kimi-question-question-1",
    });
    // The Run survives a malformed question payload.
    expect(emitted.some((event) => event.type === "failed")).toBe(false);
    expect(emitted.some((event) => event.type === "stopped")).toBe(false);
  });

  it("rejects an answer that does not match a forwarded option", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["opt_fabricated"] }],
    });
    await waitForAsyncEvents();

    expect(transport.sent.some((message) => message.id === "question-1")).toBe(false);
    expect(emitted.find((event) => event.type === "question-failed")).toMatchObject({
      type: "question-failed",
      runId: "run-kimi-question",
      questionId: "kimi-question-run-kimi-question-question-1",
    });
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);
  });

  it("rejects an Other custom-text answer for a native ACP question", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["other"], customText: "Use Python instead" }],
    });
    await waitForAsyncEvents();

    expect(transport.sent.some((message) => message.id === "question-1")).toBe(false);
    expect(emitted.find((event) => event.type === "question-failed")).toMatchObject({
      type: "question-failed",
      questionId: "kimi-question-run-kimi-question-question-1",
    });
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);
  });

  it("rejects a response for an unknown question", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-stale",
      runId: "run-kimi-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["opt_ts"] }],
    });
    await waitForAsyncEvents();

    expect(transport.sent.some((message) => message.id === "question-1")).toBe(false);
    expect(emitted.find((event) => event.type === "question-failed")).toMatchObject({
      type: "question-failed",
      questionId: "kimi-question-run-kimi-question-stale",
    });
  });

  it("ignores a response with a wrong run id and keeps the question pending", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-other",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["opt_ts"] }],
    });
    await waitForAsyncEvents();

    expect(transport.sent.some((message) => message.id === "question-1")).toBe(false);
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);

    // The real run can still answer its own question.
    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["opt_ts"] }],
    });
    await waitForAsyncEvents();

    expect(transport.sent.find((message) => message.id === "question-1")?.result).toEqual({
      outcome: { outcome: "selected", optionId: "opt_ts" },
    });
  });

  it("rejects a duplicate response after the first resolution", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    const answer = {
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "submit" as const,
      answers: [{ questionIndex: 0, optionIds: ["opt_js"] }],
    };
    handle.respondToQuestion(answer);
    await waitForAsyncEvents();
    handle.respondToQuestion(answer);
    await waitForAsyncEvents();

    // No second ACP response and no second resolution.
    expect(transport.sent.filter((message) => message.id === "question-1")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "question-resolved")).toHaveLength(1);
    expect(emitted.find((event) => event.type === "question-failed")).toMatchObject({
      type: "question-failed",
      questionId: "kimi-question-run-kimi-question-question-1",
    });
  });

  it("interrupts a pending native ACP question when the run stops and rejects late responses", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = createQuestionTransport({
      options: questionPermissionOptions,
      toolCall: askUserQuestionToolCall,
    });

    const handle = startQuestionRun(transport, emitted);
    await waitForAsyncEvents();

    handle.stop();
    const promptRequest = transport.sent.find((message) => message.method === "session/prompt")!;
    respondAcp(transport, promptRequest, { stopReason: "cancelled" });
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "stopped")).toBeDefined();

    handle.respondToQuestion({
      questionId: "kimi-question-run-kimi-question-question-1",
      runId: "run-kimi-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["opt_ts"] }],
    });
    await waitForAsyncEvents();

    expect(transport.sent.some((message) => message.id === "question-1")).toBe(false);
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);
  });
});

describe("Run-scoped MCP questions", () => {
  const mcpQuestionInput = {
    questions: [
      {
        header: "Language",
        question: "Which language should the new module use?",
        options: [
          { label: "TypeScript", description: "Use TypeScript for the new module" },
          { label: "JavaScript" },
        ],
        multi_select: false,
      },
    ],
  };

  function createFakeQuestionServerFactory() {
    const handles: Array<QuestionMcpServerHandle & { closed: boolean }> = [];
    const factory: QuestionMcpServerFactory = async () => {
      const handle: QuestionMcpServerHandle & { closed: boolean } = {
        closed: false,
        mcpServer: {
          id: "carrent_session",
          name: "carrent_session",
          type: "http",
          url: `http://127.0.0.1/${handles.length}/mcp?token=question-test`,
          headers: [],
        },
        async close() {
          handle.closed = true;
        },
      };
      handles.push(handle);
      return handle;
    };

    return { factory, handles };
  }

  function createMcpSessionTransport() {
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new" || message.method === "session/resume") {
        respondAcp(fakeTransport, message, {
          sessionId: "session-mcp-question",
          configOptions: [
            {
              id: "mode",
              currentValue: "default",
              options: [
                { value: "default", name: "Default" },
                { value: "plan", name: "Plan" },
                { value: "yolo", name: "YOLO" },
                { value: "auto", name: "Auto" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/set_config_option") {
        respondAcp(fakeTransport, message, {});
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        return;
      }

      if (message.method === "session/cancel" && promptRequest) {
        respondAcp(fakeTransport, promptRequest, { stopReason: "cancelled" });
      }
    });

    return {
      transport,
      sessionParams: () =>
        transport.sent.find(
          (message) => message.method === "session/new" || message.method === "session/resume",
        )?.params as { mcpServers?: Array<{ name: string; url: string }> } | undefined,
      promptParams: () => promptRequest?.params as { prompt?: unknown } | undefined,
      finishRun: () => {
        transport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-mcp-question",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Done" },
            },
          },
        });
        respondAcp(transport, promptRequest!, { stopReason: "end_turn" });
      },
    };
  }

  async function waitFor<T>(read: () => T | null | undefined): Promise<T> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const value = read();
      if (value) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for the expected condition.");
  }

  async function callAskUserQuestion(url: string, args: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mcp-question-1",
        method: "tools/call",
        params: { name: "ask_user_question", arguments: args },
      }),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  function startMcpQuestionRun(
    transport: FakeKimiAcpTransport,
    emitted: ChatRunEvent[],
    overrides: {
      runId?: string;
      bridgeFactory?: CarrentBridgeFactory | null;
      questionServerFactory?: QuestionMcpServerFactory | null;
      resumeSessionId?: string;
      requestOverrides?: Partial<ChatTurnRequest>;
    } = {},
  ) {
    return startKimiAcpChatRun({
      runId: overrides.runId ?? "run-kimi-mcp-question",
      request: makeRequest(overrides.requestOverrides),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: overrides.bridgeFactory,
      questionServerFactory: overrides.questionServerFactory,
      resumeSessionId: overrides.resumeSessionId,
    });
  }

  it("passes carrent_session alongside Carrent Bridge to new sessions and closes it on completion", async () => {
    const emitted: ChatRunEvent[] = [];
    const bridge = createFakeCarrentBridgeFactory();
    const questionServer = createFakeQuestionServerFactory();
    const session = createMcpSessionTransport();

    startMcpQuestionRun(session.transport, emitted, {
      bridgeFactory: bridge.factory,
      questionServerFactory: questionServer.factory,
    });
    await waitForAsyncEvents();

    expect(session.sessionParams()?.mcpServers).toEqual([
      bridge.handles[0]!.mcpServer,
      questionServer.handles[0]!.mcpServer,
    ]);

    session.finishRun();
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "completed")).toBeDefined();
    expect(questionServer.handles[0]?.closed).toBe(true);
  });

  it("passes carrent_session to resumed sessions", async () => {
    const emitted: ChatRunEvent[] = [];
    const questionServer = createFakeQuestionServerFactory();
    const session = createMcpSessionTransport();

    startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: questionServer.factory,
      resumeSessionId: "session-previous",
    });
    await waitForAsyncEvents();

    expect(session.sessionParams()?.mcpServers).toEqual([questionServer.handles[0]!.mcpServer]);
  });

  it("starts the question server even when the Carrent Bridge is unavailable", async () => {
    const emitted: ChatRunEvent[] = [];
    const questionServer = createFakeQuestionServerFactory();
    const session = createMcpSessionTransport();

    startMcpQuestionRun(session.transport, emitted, {
      bridgeFactory: async () => null,
      questionServerFactory: questionServer.factory,
    });
    await waitForAsyncEvents();

    expect(session.sessionParams()?.mcpServers).toEqual([questionServer.handles[0]!.mcpServer]);

    session.finishRun();
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "completed")).toBeDefined();
  });

  it("closes the question server when the run is stopped", async () => {
    const emitted: ChatRunEvent[] = [];
    const questionServer = createFakeQuestionServerFactory();
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: questionServer.factory,
    });
    await waitForAsyncEvents();

    handle.stop();
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "stopped")).toBeDefined();
    expect(questionServer.handles[0]?.closed).toBe(true);
  });

  it("answers a real MCP ask_user_question call with the selected option label", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    expect(requested.question).toMatchObject({
      runId: "run-kimi-mcp-question",
      threadId: "thread-1",
      provider: "kimi",
      source: "mcp",
    });
    expect(requested.question.questions).toEqual([
      {
        header: "Language",
        question: "Which language should the new module use?",
        options: [
          {
            optionId: "mcp-q1-opt-1",
            label: "TypeScript",
            description: "Use TypeScript for the new module",
          },
          { optionId: "mcp-q1-opt-2", label: "JavaScript" },
        ],
        multiSelect: false,
      },
    ]);

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["mcp-q1-opt-2"] }],
    });

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: {
        answers: { "Which language should the new module use?": "JavaScript" },
      },
    });
    expect(emitted.find((event) => event.type === "question-resolved")).toMatchObject({
      type: "question-resolved",
      outcome: "answered",
      optionId: "mcp-q1-opt-2",
      optionLabel: "JavaScript",
    });

    session.finishRun();
    await waitForAsyncEvents();
    expect(emitted.find((event) => event.type === "completed")).toBeDefined();
  });

  it("returns the Other custom text and no predefined selection for a single-select Other answer", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["other"], customText: "Use Python instead" }],
    });

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: {
        answers: { "Which language should the new module use?": "Use Python instead" },
      },
    });
    expect(emitted.find((event) => event.type === "question-resolved")).toMatchObject({
      type: "question-resolved",
      outcome: "answered",
      optionId: "other",
      optionLabel: "Use Python instead",
    });

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("presents multiple questions with full fidelity and returns one answers entry per question", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, {
      questions: [
        mcpQuestionInput.questions[0],
        {
          header: "Features",
          question: "Which features should the module include?",
          options: [
            { label: "Logging", description: "Structured logs" },
            { label: "Metrics" },
            { label: "Tracing" },
          ],
          multi_select: true,
        },
      ],
    });
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    expect(requested.question.questions).toEqual([
      {
        header: "Language",
        question: "Which language should the new module use?",
        options: [
          {
            optionId: "mcp-q1-opt-1",
            label: "TypeScript",
            description: "Use TypeScript for the new module",
          },
          { optionId: "mcp-q1-opt-2", label: "JavaScript" },
        ],
        multiSelect: false,
      },
      {
        header: "Features",
        question: "Which features should the module include?",
        options: [
          { optionId: "mcp-q2-opt-1", label: "Logging", description: "Structured logs" },
          { optionId: "mcp-q2-opt-2", label: "Metrics" },
          { optionId: "mcp-q2-opt-3", label: "Tracing" },
        ],
        multiSelect: true,
      },
    ]);

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [
        { questionIndex: 0, optionIds: ["mcp-q1-opt-1"] },
        { questionIndex: 1, optionIds: ["mcp-q2-opt-1", "mcp-q2-opt-3"] },
      ],
    });

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: {
        answers: {
          "Which language should the new module use?": "TypeScript",
          "Which features should the module include?": "Logging, Tracing",
        },
      },
    });
    expect(emitted.find((event) => event.type === "question-resolved")).toMatchObject({
      type: "question-resolved",
      outcome: "answered",
    });

    session.finishRun();
    await waitForAsyncEvents();
    expect(emitted.find((event) => event.type === "completed")).toBeDefined();
  });

  it("combines predefined multi-select labels with the Other custom text", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, {
      questions: [
        {
          header: "Features",
          question: "Which features should the module include?",
          options: [{ label: "Logging" }, { label: "Metrics" }],
          multi_select: true,
        },
      ],
    });
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [
        {
          questionIndex: 0,
          optionIds: ["mcp-q1-opt-1", "other"],
          customText: "Coverage reports",
        },
      ],
    });

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: {
        answers: { "Which features should the module include?": "Logging, Coverage reports" },
      },
    });

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("rejects a submit that omits a question and keeps the request pending", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    let httpSettled = false;
    const pendingResponse = callAskUserQuestion(serverUrl, {
      questions: [
        mcpQuestionInput.questions[0],
        {
          header: "Features",
          question: "Which features should the module include?",
          options: [{ label: "Logging" }, { label: "Metrics" }],
          multi_select: true,
        },
      ],
    }).then((value) => {
      httpSettled = true;
      return value;
    });
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["mcp-q1-opt-1"] }],
    });
    await waitFor(() => emitted.find((event) => event.type === "question-failed"));

    expect(httpSettled).toBe(false);
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "skip",
    });
    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: { answers: {} },
    });

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("rejects multiple selections on a single-select question and keeps the request pending", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    let httpSettled = false;
    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput).then((value) => {
      httpSettled = true;
      return value;
    });
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [
        {
          questionIndex: 0,
          optionIds: ["mcp-q1-opt-1", "other"],
          customText: "Use Python",
        },
      ],
    });
    await waitFor(() => emitted.find((event) => event.type === "question-failed"));

    expect(httpSettled).toBe(false);
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "skip",
    });
    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: { answers: {} },
    });

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("rejects two predefined selections on a single-select question and keeps the request pending", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    let httpSettled = false;
    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput).then((value) => {
      httpSettled = true;
      return value;
    });
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["mcp-q1-opt-1", "mcp-q1-opt-2"] }],
    });
    await waitFor(() => emitted.find((event) => event.type === "question-failed"));

    expect(httpSettled).toBe(false);
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "skip",
    });
    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: { answers: {} },
    });

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("returns empty answers with Kimi's dismissal note when the user skips", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "skip",
    });

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: {
        answers: {},
        note: "User dismissed the question without answering.",
      },
    });
    expect(emitted.find((event) => event.type === "question-resolved")).toMatchObject({
      type: "question-resolved",
      outcome: "skipped",
    });
    expect(emitted.some((event) => event.type === "stopped")).toBe(false);

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("answers a second concurrent tool call with a structured question_already_pending error", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const firstResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    await waitFor(() => emitted.find((event) => event.type === "question-requested"));

    const secondResponse = await callAskUserQuestion(serverUrl, mcpQuestionInput);
    expect(secondResponse.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "question_already_pending" } },
    });

    session.finishRun();
    await waitForAsyncEvents();
    await firstResponse;
  });

  it("flushes the pending MCP call and closes the question server when the run stops mid-question", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    await waitFor(() => emitted.find((event) => event.type === "question-requested"));

    handle.stop();
    await waitFor(() => emitted.find((event) => event.type === "stopped"));

    // Stop interrupts the question and releases the waiting HTTP connection.
    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "server_closed" } },
    });
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);
  });

  it("flushes the pending MCP call when the transport closes mid-question", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    await waitFor(() => emitted.find((event) => event.type === "question-requested"));

    session.transport.emitClose({ code: 1, signal: null, stderr: "kimi crashed" });
    await waitFor(() => emitted.find((event) => event.type === "failed"));

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "server_closed" } },
    });
  });

  it("closes the question server when startup fails after the server started", async () => {
    const emitted: ChatRunEvent[] = [];
    const questionServer = createFakeQuestionServerFactory();
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "session storage unavailable" },
        });
      }
    });

    startMcpQuestionRun(transport, emitted, {
      questionServerFactory: questionServer.factory,
    });
    await waitFor(() => emitted.find((event) => event.type === "failed"));

    expect(questionServer.handles).toHaveLength(1);
    expect(questionServer.handles[0]?.closed).toBe(true);
  });

  it("rejects a late response after the run terminated without settling the call twice", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    handle.stop();
    await waitFor(() => emitted.find((event) => event.type === "stopped"));

    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["mcp-q1-opt-1"] }],
    });
    await waitForAsyncEvents();

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "server_closed" } },
    });
    expect(emitted.some((event) => event.type === "question-resolved")).toBe(false);
  });

  it("rejects a duplicate response after the first resolution", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    const answer = {
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit" as const,
      answers: [{ questionIndex: 0, optionIds: ["mcp-q1-opt-2"] }],
    };
    handle.respondToQuestion(answer);
    await waitFor(() => emitted.find((event) => event.type === "question-resolved"));

    handle.respondToQuestion(answer);
    await waitFor(() => emitted.find((event) => event.type === "question-failed"));

    const response = await pendingResponse;
    expect(response.result).toMatchObject({
      structuredContent: {
        answers: { "Which language should the new module use?": "JavaScript" },
      },
    });
    expect(emitted.filter((event) => event.type === "question-resolved")).toHaveLength(1);

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("cancels a native ACP question that arrives while an MCP question is pending", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );

    session.transport.emitMessage({
      jsonrpc: "2.0",
      id: "question-acp-1",
      method: "session/request_permission",
      params: {
        sessionId: "session-mcp-question",
        options: [
          { optionId: "opt_ts", name: "TypeScript", kind: "allow_once" },
          { optionId: "opt_js", name: "JavaScript", kind: "allow_once" },
        ],
        toolCall: {
          toolCallId: "tool-ask-user-question",
          title: "AskUserQuestion",
          kind: "other",
          status: "pending",
          rawInput: mcpQuestionInput,
        },
      },
    });
    await waitForAsyncEvents();

    // The second request is cancelled upstream and never reaches the panel.
    expect(
      session.transport.sent.find((message) => message.id === "question-acp-1")?.result,
    ).toEqual({ outcome: { outcome: "cancelled" } });
    expect(emitted.filter((event) => event.type === "question-requested")).toHaveLength(1);

    // The active MCP question still resolves normally.
    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "skip",
    });
    const response = await pendingResponse;
    expect(response.result).toMatchObject({ structuredContent: { answers: {} } });

    session.finishRun();
    await waitForAsyncEvents();
  });

  it("rejects an MCP call with question_already_pending while a native ACP question is pending", async () => {
    const emitted: ChatRunEvent[] = [];
    const session = createMcpSessionTransport();

    const handle = startMcpQuestionRun(session.transport, emitted, {
      questionServerFactory: (options) => startQuestionMcpServer(options),
    });
    const serverUrl = await waitFor(
      () =>
        session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
          ?.url,
    );

    session.transport.emitMessage({
      jsonrpc: "2.0",
      id: "question-acp-1",
      method: "session/request_permission",
      params: {
        sessionId: "session-mcp-question",
        options: [
          { optionId: "opt_ts", name: "TypeScript", kind: "allow_once" },
          { optionId: "opt_js", name: "JavaScript", kind: "allow_once" },
          { optionId: "opt_dismiss", name: "Dismiss", kind: "reject_once" },
        ],
        toolCall: {
          toolCallId: "tool-ask-user-question",
          title: "AskUserQuestion",
          kind: "other",
          status: "pending",
          rawInput: mcpQuestionInput,
        },
      },
    });
    const requested = await waitFor(() =>
      emitted.find(
        (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
          event.type === "question-requested",
      ),
    );
    expect(requested.question.source).toBe("native-acp");

    const mcpResponse = await callAskUserQuestion(serverUrl, mcpQuestionInput);
    expect(mcpResponse.result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "question_already_pending" } },
    });

    // The native ACP question still resolves normally.
    handle.respondToQuestion({
      questionId: requested.question.id,
      runId: "run-kimi-mcp-question",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["opt_js"] }],
    });
    await waitForAsyncEvents();
    expect(
      session.transport.sent.find((message) => message.id === "question-acp-1")?.result,
    ).toEqual({ outcome: { outcome: "selected", optionId: "opt_js" } });

    session.finishRun();
    await waitForAsyncEvents();
  });

  describe("question server mode gating", () => {
    async function sessionDescriptorSet(
      requestOverrides: Partial<ChatTurnRequest>,
      resume = false,
    ) {
      const emitted: ChatRunEvent[] = [];
      const questionServer = createFakeQuestionServerFactory();
      const session = createMcpSessionTransport();

      startMcpQuestionRun(session.transport, emitted, {
        questionServerFactory: questionServer.factory,
        requestOverrides,
        resumeSessionId: resume ? "session-previous" : undefined,
      });
      await waitForAsyncEvents();

      return { session, questionServer };
    }

    it("starts the question server for Approval required, Auto-accept edits, and Plan mode runs", async () => {
      const supportedModes: Array<Partial<ChatTurnRequest>> = [
        { runtimeMode: "approval-required" },
        { runtimeMode: "auto-accept-edits" },
        { runtimeMode: "approval-required", planMode: true },
        { runtimeMode: "full-access", planMode: true },
      ];

      for (const requestOverrides of supportedModes) {
        const { session, questionServer } = await sessionDescriptorSet(requestOverrides);
        expect(questionServer.handles).toHaveLength(1);
        expect(session.sessionParams()?.mcpServers).toEqual([questionServer.handles[0]!.mcpServer]);
      }
    });

    it("omits carrent_session for Auto runs and never starts the question server", async () => {
      const emitted: ChatRunEvent[] = [];
      const bridge = createFakeCarrentBridgeFactory();
      const questionServer = createFakeQuestionServerFactory();
      const session = createMcpSessionTransport();

      startMcpQuestionRun(session.transport, emitted, {
        bridgeFactory: bridge.factory,
        questionServerFactory: questionServer.factory,
        requestOverrides: { runtimeMode: "full-access" },
      });
      await waitForAsyncEvents();

      // The global Carrent Bridge is orthogonal and still attached.
      expect(questionServer.handles).toHaveLength(0);
      expect(session.sessionParams()?.mcpServers).toEqual([bridge.handles[0]!.mcpServer]);

      // Prompt neutrality: mode gating never alters the user prompt.
      session.finishRun();
      await waitForAsyncEvents();
      expect(session.promptParams()?.prompt).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("omits carrent_session for resumed Auto sessions", async () => {
      const { session, questionServer } = await sessionDescriptorSet(
        { runtimeMode: "full-access" },
        true,
      );

      expect(questionServer.handles).toHaveLength(0);
      expect(session.sessionParams()?.mcpServers).toEqual([]);
    });
  });

  describe("question diagnostics", () => {
    function captureQuestionLogs() {
      const originalInfo = console.info;
      const lines: string[] = [];
      console.info = (...args: unknown[]) => {
        lines.push(args.join(" "));
      };
      return {
        lines: () => lines.filter((line) => line.includes("[chat:question]")),
        restore: () => {
          console.info = originalInfo;
        },
      };
    }

    it("logs the MCP question lifecycle without free-text answers", async () => {
      const logs = captureQuestionLogs();
      const emitted: ChatRunEvent[] = [];
      const session = createMcpSessionTransport();

      try {
        const handle = startMcpQuestionRun(session.transport, emitted, {
          questionServerFactory: (options) => startQuestionMcpServer(options),
        });
        const serverUrl = await waitFor(
          () =>
            session.sessionParams()?.mcpServers?.find((server) => server.name === "carrent_session")
              ?.url,
        );

        const pendingResponse = callAskUserQuestion(serverUrl, mcpQuestionInput);
        const requested = await waitFor(() =>
          emitted.find(
            (event): event is Extract<ChatRunEvent, { type: "question-requested" }> =>
              event.type === "question-requested",
          ),
        );

        handle.respondToQuestion({
          questionId: requested.question.id,
          runId: "run-kimi-mcp-question",
          action: "submit",
          answers: [{ questionIndex: 0, optionIds: ["other"], customText: "Use Python instead" }],
        });
        await pendingResponse;

        const lines = logs.lines();
        expect(
          lines.some((line) => line.includes("requested") && line.includes("source=mcp")),
        ).toBe(true);
        expect(
          lines.some((line) => line.includes("resolved") && line.includes("outcome=answered")),
        ).toBe(true);
        expect(lines.some((line) => line.includes("Use Python instead"))).toBe(false);

        session.finishRun();
        await waitForAsyncEvents();
      } finally {
        logs.restore();
      }
    });

    it("distinguishes the native ACP path and logs interruptions and rejections", async () => {
      const logs = captureQuestionLogs();
      const emitted: ChatRunEvent[] = [];
      const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
        if (message.method === "initialize") {
          respondAcp(fakeTransport, message, { protocolVersion: 1 });
          return;
        }

        if (message.method === "session/new") {
          respondAcp(fakeTransport, message, { sessionId: "session-question" });
          return;
        }

        if (message.method === "session/prompt") {
          queueMicrotask(() => {
            fakeTransport.emitMessage({
              jsonrpc: "2.0",
              id: "question-1",
              method: "session/request_permission",
              params: {
                sessionId: "session-question",
                options: [
                  { optionId: "opt_ts", name: "TypeScript", kind: "allow_once" },
                  { optionId: "opt_js", name: "JavaScript", kind: "allow_once" },
                ],
                toolCall: {
                  toolCallId: "tool-ask-user-question",
                  title: "AskUserQuestion",
                  kind: "other",
                  status: "pending",
                  rawInput: {
                    questions: [
                      {
                        header: "Language",
                        question: "Which language should the new module use?",
                        options: [{ label: "TypeScript" }, { label: "JavaScript" }],
                        multi_select: false,
                      },
                    ],
                  },
                },
              },
            });
          });
        }
      });

      try {
        const handle = startKimiAcpChatRun({
          runId: "run-kimi-question",
          request: makeRequest(),
          cwd: "/Users/onion/workbench/carrent",
          emit: (event) => emitted.push(event),
          transportFactory: () => transport,
        });
        await waitFor(() => emitted.find((event) => event.type === "question-requested"));

        // A stale response id is rejected, then stopping interrupts the question.
        handle.respondToQuestion({
          questionId: "kimi-question-run-kimi-question-stale",
          runId: "run-kimi-question",
          action: "skip",
        });
        await waitForAsyncEvents();
        handle.stop();
        const promptRequest = transport.sent.find(
          (message) => message.method === "session/prompt",
        )!;
        respondAcp(transport, promptRequest, { stopReason: "cancelled" });
        await waitFor(() => emitted.find((event) => event.type === "stopped"));

        const lines = logs.lines();
        expect(
          lines.some((line) => line.includes("requested") && line.includes("source=native-acp")),
        ).toBe(true);
        expect(lines.some((line) => line.includes("response_rejected"))).toBe(true);
        expect(
          lines.some((line) => line.includes("interrupted") && line.includes("source=native-acp")),
        ).toBe(true);
      } finally {
        logs.restore();
      }
    });
  });
});
