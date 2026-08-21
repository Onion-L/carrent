import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";

import { classifyToolApproval } from "./approvalPolicy";
import { createAgentModels } from "./models";
import { buildSystemPrompt } from "./systemPrompt";
import { createAgentTools } from "./tools";
import { accessModeOf } from "./types";
import type { AgentCoreDependencies, AgentRunHandle, AgentRunInput, AgentRunResult } from "./types";

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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

function historyMessages(input: AgentRunInput, now: () => number): AgentMessage[] {
  return input.transcript.map((message) => {
    if (message.role === "user") {
      return { role: "user", content: message.content, timestamp: now() };
    }
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api:
        input.profile.type === "anthropic"
          ? "anthropic-messages"
          : input.profile.type === "kimi-coding"
            ? "anthropic-messages"
            : "openai-completions",
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
        const agentModels = createAgentModels(
          input.profile,
          dependencies.homeDirectory,
          dependencies.clientVersion,
        );
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
            model: agentModels.model,
            thinkingLevel: input.profile.thinking === true ? "medium" : "off",
            tools,
            messages,
          },
          streamFn:
            dependencies.streamFn ??
            ((model, context, options) => agentModels.models.streamSimple(model, context, options)),
          toolExecution: "sequential",
          beforeToolCall: async ({ toolCall, args }) => {
            const classification = await classifyToolApproval({
              toolName: toolCall.name,
              args,
              workingDirectory: input.workingDirectory,
              access: accessModeOf(input.mode),
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
