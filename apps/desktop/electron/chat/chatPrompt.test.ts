import { describe, it, expect } from "bun:test";
import { buildChatPrompt } from "./chatPrompt";
import type { ChatTurnRequest } from "../../src/shared/chat";

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    workspace: {
      kind: "project",
      projectId: "timbre",
      projectPath: "/Users/onion/workbench/timbre",
    },
    threadId: "thread-1",
    runtimeId: "codex",
    runtimeMode: "approval-required",
    transcript: [],
    message: "Hello",
    ...overrides,
  };
}

describe("buildChatPrompt", () => {
  it("includes context and user message without agent instructions", () => {
    const prompt = buildChatPrompt(makeRequest());
    expect(prompt).toContain("Hello");
    expect(prompt).not.toContain("You are Architect.");
    expect(prompt).not.toContain("RTK is enabled.");
    expect(prompt).not.toContain("Carrent runtime instruction");
  });

  it("keeps only the most recent transcript slice", () => {
    const transcript = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));

    const prompt = buildChatPrompt(makeRequest({ transcript, message: "Latest" }));

    // Should include the most recent messages
    expect(prompt).toContain("Message 19");
    expect(prompt).toContain("Message 18");

    // Should not include very old messages (we cap at last 6)
    expect(prompt).not.toContain("Message 0\n");
    expect(prompt).not.toContain("Message 2\n");
  });

  it("includes project path context", () => {
    const prompt = buildChatPrompt(
      makeRequest({
        workspace: {
          kind: "project",
          projectId: "carrent",
          projectPath: "/Users/onion/workbench/carrent",
        },
      }),
    );
    expect(prompt).toContain("/Users/onion/workbench/carrent");
  });

  it("includes project context for project chats", () => {
    const prompt = buildChatPrompt(
      makeRequest({
        workspace: {
          kind: "project",
          projectId: "carrent",
          projectPath: "/Users/onion/workbench/carrent",
        },
      }),
    );

    expect(prompt).toContain("Project: /Users/onion/workbench/carrent");
  });

  it("includes no-project context for chat-only threads", () => {
    const prompt = buildChatPrompt(
      makeRequest({
        workspace: { kind: "chat" },
      }),
    );

    expect(prompt).toContain("Context: General chat. No project folder is selected.");
    expect(prompt).not.toContain("Project:");
  });

  it("formats transcript as role: content pairs", () => {
    const prompt = buildChatPrompt(
      makeRequest({
        transcript: [
          { role: "user", content: "What is the best pattern?" },
          { role: "assistant", content: "Use composition." },
        ],
        message: "Thanks",
      }),
    );
    expect(prompt).toContain("user: What is the best pattern?");
    expect(prompt).toContain("assistant: Use composition.");
  });

  it("can omit transcript when the runtime resumes its own session", () => {
    const prompt = buildChatPrompt(
      makeRequest({
        transcript: [
          { role: "user", content: "Earlier question" },
          { role: "assistant", content: "Earlier answer" },
        ],
        message: "Only send this turn",
      }),
      { includeTranscript: false },
    );

    expect(prompt).not.toContain("Recent conversation:");
    expect(prompt).not.toContain("Earlier question");
    expect(prompt).toContain("Only send this turn");
  });

  it("caps transcript by total serialized character count", () => {
    const longContent = "a".repeat(2000);
    const transcript = Array.from({ length: 4 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: longContent,
    }));

    const prompt = buildChatPrompt(makeRequest({ transcript, message: "Hi" }));

    // 4 messages * 2000 chars = 8000+ chars, should be capped to under 6000
    // by dropping messages from the front
    const transcriptSection = prompt.split("Recent conversation:")[1]?.split("user: Hi")[0] ?? "";
    expect(transcriptSection.length).toBeLessThan(6000);
  });

  it("uses a default prompt for image-only messages", () => {
    const prompt = buildChatPrompt(
      makeRequest({
        message: "",
        attachments: [
          {
            id: "a1",
            name: "screenshot.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
          },
        ],
      }),
    );

    expect(prompt).toContain("Inspect the attached images");
  });

  it("includes image references for text-only runtimes", () => {
    const prompt = buildChatPrompt(
      makeRequest({
        message: "Check this",
        attachments: [
          {
            id: "a1",
            name: "screenshot.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
            localPath: "/tmp/attachments/a1.png",
          },
        ],
      }),
    );

    expect(prompt).toContain("Attached images:");
    expect(prompt).toContain("screenshot.png");
    expect(prompt).toContain("/tmp/attachments/a1.png");
  });

  it("does not include an image section when no attachments are present", () => {
    const prompt = buildChatPrompt(makeRequest({ message: "No images" }));

    expect(prompt).not.toContain("Attached images:");
  });
});
