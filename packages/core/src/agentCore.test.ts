import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";

import { createAgentCore } from "./agentCore";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("createAgentCore", () => {
  it("runs a Provider Profile through pi-agent-core and streams the final text", async () => {
    const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "carrent-core-project-"));
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "carrent-core-home-"));
    const textDeltas: string[] = [];
    const contexts: Array<Extract<import("./types").AgentCoreEvent, { type: "run-context" }>> = [];
    let capturedModel: Model<Api> | undefined;
    let capturedContext: Context | undefined;

    const core = createAgentCore({
      homeDirectory,
      now: () => 1,
      streamFn: (model, context) => {
        capturedModel = model;
        capturedContext = context;
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage,
          stopReason: "stop",
          timestamp: 1,
        };
        stream.push({ type: "start", partial: { ...message, content: [] } });
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: "Done", partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: "Done", partial: message });
        stream.push({ type: "done", reason: "stop", message });
        return stream;
      },
    });

    const handle = core.run({
      id: "run-1",
      workingDirectory,
      profile: {
        id: "local-openai",
        type: "openai-compatible",
        apiKey: "secret",
        baseUrl: "http://localhost:11434/v1/",
        modelId: "model-1",
      },
      mode: "ask",
      transcript: [],
      prompt: "Finish the task",
      requestApproval: async () => "reject",
      onEvent: (event) => {
        if (event.type === "text-delta") textDeltas.push(event.delta);
        if (event.type === "run-context") contexts.push(event);
      },
    });

    const result = await handle.result;
    expect(result.text).toBe("Done");
    expect(textDeltas).toEqual(["Done"]);
    expect(contexts.length).toBe(1);
    expect(contexts[0]?.model).toEqual({
      profileId: "local-openai",
      providerType: "openai-compatible",
      baseUrl: "http://localhost:11434/v1/",
      modelId: "model-1",
    });
    expect(JSON.stringify(contexts[0]).includes("secret")).toBe(false);
    expect(capturedModel?.id).toBe("model-1");
    expect(capturedModel?.provider).toBe("local-openai");
    expect(capturedModel?.api).toBe("openai-completions");
    expect(capturedModel?.baseUrl).toBe("http://localhost:11434/v1");
    expect(capturedContext?.systemPrompt).toContain(
      `Project working directory: ${workingDirectory}`,
    );
    const finalMessage = capturedContext?.messages.at(-1);
    expect(finalMessage?.role).toBe("user");
    expect(finalMessage?.role === "user" ? finalMessage.content : null).toEqual([
      { type: "text", text: "Finish the task" },
    ]);
  });
});
