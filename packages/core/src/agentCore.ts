import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as streamOpenAi } from "@earendil-works/pi-ai/api/openai-completions";

import { classifyToolApproval } from "./approvalPolicy";
import { buildSystemPrompt } from "./systemPrompt";
import { createAgentTools } from "./tools";
import type {
  AgentCoreDependencies,
  AgentRunHandle,
  AgentRunInput,
  AgentRunResult,
  ProviderProfile,
} from "./types";

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createModel(profile: ProviderProfile): Model<Api> {
  const thinking = profile.thinking === true;
  return {
    id: profile.modelId,
    name: profile.modelId,
    api: profile.type === "anthropic" ? "anthropic-messages" : "openai-completions",
    provider: profile.id,
    baseUrl: profile.baseUrl.replace(/\/$/, ""),
    reasoning: thinking,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: profile.type === "anthropic" ? 200_000 : 128_000,
    maxTokens: 8_192,
  };
}

function debugBaseUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid base URL>";
  }
}

const defaultStreamFn: StreamFn = (model, context, options) =>
  model.api === "anthropic-messages"
    ? streamAnthropic(model as Model<"anthropic-messages">, context, options)
    : streamOpenAi(model as Model<"openai-completions">, context, options);

function historyMessages(input: AgentRunInput, now: () => number): AgentMessage[] {
  return input.transcript.map((message) => {
    if (message.role === "user") {
      return { role: "user", content: message.content, timestamp: now() };
    }
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: input.profile.type === "anthropic" ? "anthropic-messages" : "openai-completions",
      provider: input.profile.id,
      model: input.profile.modelId,
      usage: ZERO_USAGE,
      stopReason: "stop",
      timestamp: now(),
    } satisfies AssistantMessage;
  });
}

function assistantText(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("");
}

export function createAgentCore(dependencies: AgentCoreDependencies = {}) {
  const now = dependencies.now ?? Date.now;

  return {
    run(input: AgentRunInput): AgentRunHandle {
      let agent: Agent | null = null;
      let cancelled = false;

      const result = (async (): Promise<AgentRunResult> => {
        const systemPrompt = await buildSystemPrompt({
          workingDirectory: input.workingDirectory,
          homeDirectory: dependencies.homeDirectory,
          override: input.systemPrompt,
        });
        if (cancelled) throw new Error("Run was cancelled.");

        const messages = historyMessages(input, now);
        const tools = createAgentTools(input.workingDirectory);
        await input.onEvent?.({
          type: "run-context",
          systemPrompt,
          messages,
          model: {
            profileId: input.profile.id,
            providerType: input.profile.type,
            baseUrl: debugBaseUrl(input.profile.baseUrl),
            modelId: input.profile.modelId,
          },
          tools: tools.map((tool) => ({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            parameters: tool.parameters,
          })),
        });

        let finalText = "";
        agent = new Agent({
          initialState: {
            systemPrompt,
            model: createModel(input.profile),
            thinkingLevel: input.profile.thinking === true ? "medium" : "off",
            tools,
            messages,
          },
          streamFn: dependencies.streamFn ?? defaultStreamFn,
          getApiKey: () => input.profile.apiKey,
          toolExecution: "sequential",
          beforeToolCall: async ({ toolCall, args }) => {
            const classification = await classifyToolApproval({
              toolName: toolCall.name,
              args,
              workingDirectory: input.workingDirectory,
              mode: input.mode,
            });
            if (!classification.requiresApproval) return undefined;
            const decision = await input.requestApproval({
              id: `${input.id}:${toolCall.id}`,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              ...classification,
            });
            return decision === "reject"
              ? { block: true, reason: "The user rejected this action." }
              : undefined;
          },
        });
        agent.subscribe(async (event) => {
          if (event.type === "message_update") {
            const update = event.assistantMessageEvent;
            if (update.type === "text_delta") {
              await input.onEvent?.({ type: "text-delta", delta: update.delta });
            } else if (update.type === "thinking_delta") {
              await input.onEvent?.({ type: "thinking_delta", delta: update.delta });
            }
          } else if (event.type === "message_end" && event.message.role === "assistant") {
            finalText = assistantText(event.message);
          } else if (event.type === "tool_execution_start") {
            await input.onEvent?.({
              type: "tool-start",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
            });
          } else if (event.type === "tool_execution_update") {
            await input.onEvent?.({
              type: "tool-update",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              update: event.partialResult,
            });
          } else if (event.type === "tool_execution_end") {
            await input.onEvent?.({
              type: "tool-end",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: event.result,
              isError: event.isError,
            });
          }
          await input.onEvent?.({ type: "agent-event", event: event as AgentEvent });
        });
        if (cancelled) agent.abort();
        await agent.prompt(input.prompt);
        if (cancelled || agent.state.errorMessage === "Request was aborted") {
          throw new Error("Run was cancelled.");
        }
        if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
        return { text: finalText, messages: [...agent.state.messages] };
      })();

      return {
        result,
        cancel: () => {
          cancelled = true;
          agent?.abort();
        },
      };
    },
  };
}
