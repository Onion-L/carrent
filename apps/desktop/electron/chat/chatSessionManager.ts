import type { ChildProcess } from "node:child_process";
import type {
  ChatReasoningEventPayload,
  ChatShellEventPayload,
  ChatTurnRequest,
  ChatRunEvent,
} from "../../src/shared/chat";
import { buildChatPrompt } from "./chatPrompt";
import { getRuntimeCommand } from "./chatRunner";

interface ChatSession {
  runId: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  stoppedByUser: boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeout?: number;
    windowsHide?: boolean;
    stdio?: ["ignore", "pipe", "pipe"];
  },
) => ChildProcess;

export interface ChatSessionManager {
  start: (runId: string, request: ChatTurnRequest) => void;
  stop: (runId: string) => void;
}

type ClaudeStreamState = {
  buffer: string;
  text: string;
  finalText: string;
  reasoningText: string;
  reasoningStatus: "running" | "completed" | null;
  sessionId: string | null;
  shellCommands: Map<string, string>;
};

type CodexStreamState = {
  buffer: string;
  text: string;
};

const MAX_SHELL_OUTPUT_LENGTH = 12_000;

function createClaudeStreamState(): ClaudeStreamState {
  return {
    buffer: "",
    text: "",
    finalText: "",
    reasoningText: "",
    reasoningStatus: null,
    sessionId: null,
    shellCommands: new Map(),
  };
}

function createCodexStreamState(): CodexStreamState {
  return {
    buffer: "",
    text: "",
  };
}

function truncateShellOutput(output: string) {
  if (output.length <= MAX_SHELL_OUTPUT_LENGTH) {
    return output;
  }

  return `${output.slice(0, MAX_SHELL_OUTPUT_LENGTH)}\n\n[output truncated]`;
}

function extractClaudeSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = (payload as { session_id?: unknown }).session_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractClaudeTextDelta(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const event = (payload as { event?: unknown }).event;
  if (!event || typeof event !== "object") {
    return null;
  }

  const delta = (event as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") {
    return null;
  }

  const deltaType = (delta as { type?: unknown }).type;
  if (deltaType !== "text_delta") {
    return null;
  }

  const text = (delta as { text?: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function emitShellEvent(
  emit: (event: ChatRunEvent) => void,
  runId: string,
  requestKey: string | undefined,
  shell: ChatShellEventPayload,
) {
  emit({
    type: "shell",
    runId,
    ...(requestKey ? { requestKey } : {}),
    shell: {
      ...shell,
      output: truncateShellOutput(shell.output),
    },
  });
}

function emitReasoningEvent(
  emit: (event: ChatRunEvent) => void,
  runId: string,
  requestKey: string | undefined,
  reasoning: ChatReasoningEventPayload,
) {
  emit({
    type: "reasoning",
    runId,
    ...(requestKey ? { requestKey } : {}),
    reasoning,
  });
}

function extractCodexShellEvent(payload: unknown): ChatShellEventPayload | null {
  const envelope = readObject(payload);
  const item = readObject(envelope?.item);
  if (!envelope || !item || item.type !== "command_execution") {
    return null;
  }

  const id = readString(item.id);
  const command = readString(item.command);
  if (!id || !command) {
    return null;
  }

  const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
  const exitCode =
    typeof item.exit_code === "number" || item.exit_code === null ? item.exit_code : null;

  if (envelope.type === "item.started") {
    return {
      id,
      command,
      output,
      status: "running",
      exitCode,
    };
  }

  if (envelope.type === "item.completed") {
    return {
      id,
      command,
      output,
      status: exitCode === 0 ? "completed" : "failed",
      exitCode,
    };
  }

  return null;
}

function readReasoningText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(readReasoningText).filter(Boolean).join("\n");
  }

  const item = readObject(value);
  if (!item) {
    return "";
  }

  return (
    readString(item.text) ??
    readString(item.summary) ??
    readString(item.content) ??
    readString(item.reasoning) ??
    readString(item.thinking) ??
    ""
  );
}

function extractCodexReasoningEvent(payload: unknown): ChatReasoningEventPayload | null {
  const envelope = readObject(payload);
  const item = readObject(envelope?.item);
  if (!envelope || !item) {
    return null;
  }

  if (item.type !== "reasoning" && item.type !== "reasoning_summary") {
    return null;
  }

  const id = readString(item.id) ?? "codex-reasoning";
  const content =
    readReasoningText(item.text) ||
    readReasoningText(item.summary) ||
    readReasoningText(item.content);

  if (envelope.type === "item.started") {
    return {
      id,
      content,
      status: "running",
    };
  }

  if (envelope.type === "item.completed" && content) {
    return {
      id,
      content,
      status: "completed",
    };
  }

  return null;
}

function extractCodexAgentMessage(payload: unknown): string | null {
  const envelope = readObject(payload);
  const item = readObject(envelope?.item);
  if (!envelope || !item || envelope.type !== "item.completed" || item.type !== "agent_message") {
    return null;
  }

  return readString(item.text);
}

function extractClaudeBashToolUse(
  state: ClaudeStreamState,
  payload: unknown,
): ChatShellEventPayload[] {
  const envelope = readObject(payload);
  const message = readObject(envelope?.message);
  const content = message?.content;
  if (envelope?.type !== "assistant" || !Array.isArray(content)) {
    return [];
  }

  return content.flatMap((item): ChatShellEventPayload[] => {
    const block = readObject(item);
    const input = readObject(block?.input);
    const id = readString(block?.id);
    const command = readString(input?.command);
    if (block?.type !== "tool_use" || block.name !== "Bash" || !id || !command) {
      return [];
    }

    state.shellCommands.set(id, command);
    return [
      {
        id,
        command,
        output: "",
        status: "running",
      },
    ];
  });
}

function extractClaudeToolResult(
  state: ClaudeStreamState,
  payload: unknown,
): ChatShellEventPayload[] {
  const envelope = readObject(payload);
  const message = readObject(envelope?.message);
  const content = message?.content;
  if (envelope?.type !== "user" || !Array.isArray(content)) {
    return [];
  }

  const toolUseResult = readObject(envelope.tool_use_result);
  const stdout = typeof toolUseResult?.stdout === "string" ? toolUseResult.stdout : "";
  const stderr = typeof toolUseResult?.stderr === "string" ? toolUseResult.stderr : "";

  return content.flatMap((item): ChatShellEventPayload[] => {
    const block = readObject(item);
    const id = readString(block?.tool_use_id);
    if (block?.type !== "tool_result" || !id || !state.shellCommands.has(id)) {
      return [];
    }

    const fallbackContent = typeof block.content === "string" ? block.content : "";
    const output =
      stdout || stderr
        ? [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean).join("\n")
        : fallbackContent;

    return [
      {
        id,
        command: state.shellCommands.get(id) ?? "Bash",
        output,
        status: block.is_error === true ? "failed" : "completed",
      },
    ];
  });
}

function extractClaudeFinalText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = (payload as { result?: unknown }).result;
  if (typeof result === "string" && result.length > 0) {
    return result;
  }

  const message = (payload as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const value = (item as { text?: unknown }).text;
      return typeof value === "string" ? value : "";
    })
    .join("");

  return text.length > 0 ? text : null;
}

function extractClaudeThinkingDelta(payload: unknown): string | null {
  const envelope = readObject(payload);
  const event = readObject(envelope?.event);
  const delta = readObject(event?.delta);
  if (!delta || delta.type !== "thinking_delta") {
    return null;
  }

  return readString(delta.thinking) ?? readString(delta.text);
}

function extractClaudeThinkingBlock(payload: unknown): string | null {
  const envelope = readObject(payload);
  const message = readObject(envelope?.message);
  const content = message?.content;
  if (envelope?.type !== "assistant" || !Array.isArray(content)) {
    return null;
  }

  const thinking = content
    .map((item) => {
      const block = readObject(item);
      if (block?.type !== "thinking") {
        return "";
      }

      return readString(block.thinking) ?? readString(block.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");

  return thinking || null;
}

function consumeClaudeStreamChunk(
  state: ClaudeStreamState,
  chunk: string,
  onDelta: (text: string) => void,
  onShell: (shell: ChatShellEventPayload) => void,
  onReasoning: (reasoning: ChatReasoningEventPayload) => void,
) {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const payload = JSON.parse(trimmed);
      const sessionId = extractClaudeSessionId(payload);
      if (sessionId) {
        state.sessionId = sessionId;
      }

      const thinkingBlock = extractClaudeThinkingBlock(payload);
      if (thinkingBlock) {
        state.reasoningText = thinkingBlock;
        state.reasoningStatus = "completed";
        onReasoning({
          id: "claude-thinking",
          content: state.reasoningText,
          status: "completed",
        });
      }

      for (const shell of extractClaudeBashToolUse(state, payload)) {
        onShell(shell);
      }

      for (const shell of extractClaudeToolResult(state, payload)) {
        onShell(shell);
      }

      const finalText = extractClaudeFinalText(payload);
      if (finalText) {
        state.finalText = finalText;
      }

      const thinkingDelta = extractClaudeThinkingDelta(payload);
      if (thinkingDelta) {
        state.reasoningText += thinkingDelta;
        state.reasoningStatus = "running";
        onReasoning({
          id: "claude-thinking",
          content: state.reasoningText,
          status: "running",
        });
        continue;
      }

      const delta = extractClaudeTextDelta(payload);
      if (!delta) {
        continue;
      }

      state.text += delta;
      onDelta(delta);
    } catch {
      continue;
    }
  }
}

function consumeCodexStreamChunk(
  state: CodexStreamState,
  chunk: string,
  onDelta: (text: string) => void,
  onShell: (shell: ChatShellEventPayload) => void,
  onReasoning: (reasoning: ChatReasoningEventPayload) => void,
) {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const payload = JSON.parse(trimmed);
      const shell = extractCodexShellEvent(payload);
      if (shell) {
        onShell(shell);
        continue;
      }

      const reasoning = extractCodexReasoningEvent(payload);
      if (reasoning) {
        onReasoning(reasoning);
        continue;
      }

      const text = extractCodexAgentMessage(payload);
      if (text) {
        state.text += text;
        onDelta(text);
      }
    } catch {
      continue;
    }
  }
}

function buildRequestSessionKey(request: ChatTurnRequest) {
  return `${request.runtimeId}:${request.projectPath}:${request.threadId}:${request.agent.id}`;
}

function getSessionRuntimeCommand(
  request: ChatTurnRequest,
  options?: {
    includeTranscript?: boolean;
    resumeSessionId?: string | null;
  },
) {
  const resumeSessionId = options?.resumeSessionId ?? null;
  const prompt = buildChatPrompt(request, {
    includeTranscript: options?.includeTranscript,
  });

  if (request.runtimeId === "codex") {
    return {
      command: "codex",
      args: ["exec", "--json", "--skip-git-repo-check", "--ephemeral", prompt],
    };
  }

  if (request.runtimeId !== "claude-code") {
    return getRuntimeCommand(request.runtimeId, prompt);
  }

  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  args.push(prompt);

  return {
    command: "claude",
    args,
  };
}

export type ProviderSessionStore = {
  get: (key: string) => string | undefined;
  set: (key: string, sessionId: string) => void | Promise<void>;
};

export function createChatSessionManager(options: {
  emit: (event: ChatRunEvent) => void;
  spawn: SpawnFn;
  providerSessions?: ProviderSessionStore;
}): ChatSessionManager {
  const sessions = new Map<string, ChatSession>();
  const runtimeSessions = new Map<string, string>();
  const TIMEOUT_MS = 120_000;

  function start(runId: string, request: ChatTurnRequest) {
    if (!request.projectPath) {
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: "Project path is missing. Select a project to chat.",
      });
      return;
    }

    const requestSessionKey = buildRequestSessionKey(request);
    const resumeSessionId =
      request.runtimeId === "claude-code"
        ? (runtimeSessions.get(requestSessionKey) ??
            options.providerSessions?.get(requestSessionKey) ??
            null)
        : null;

    spawnAttempt({
      runId,
      request,
      requestSessionKey,
      resumeSessionId,
      includeTranscript: !(request.runtimeId === "claude-code" && resumeSessionId),
      allowResumeFallback: request.runtimeId === "claude-code" && !!resumeSessionId,
      emitLifecycleEvents: true,
    });
  }

  function spawnAttempt({
    runId,
    request,
    requestSessionKey,
    resumeSessionId,
    includeTranscript,
    allowResumeFallback,
    emitLifecycleEvents,
  }: {
    runId: string;
    request: ChatTurnRequest;
    requestSessionKey: string;
    resumeSessionId: string | null;
    includeTranscript: boolean;
    allowResumeFallback: boolean;
    emitLifecycleEvents: boolean;
  }) {
    const { command, args } = getSessionRuntimeCommand(request, {
      includeTranscript,
      resumeSessionId,
    });

    const timeoutHandle = setTimeout(() => {
      const session = sessions.get(runId);
      if (session) {
        session.child.kill("SIGTERM");
      }
    }, TIMEOUT_MS);

    const child = options.spawn(command, args, {
      cwd: request.projectPath,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const claudeStreamState =
      request.runtimeId === "claude-code" ? createClaudeStreamState() : null;
    const codexStreamState = request.runtimeId === "codex" ? createCodexStreamState() : null;

    const session: ChatSession = {
      runId,
      child,
      stdout: "",
      stderr: "",
      stoppedByUser: false,
      timeoutHandle,
    };
    sessions.set(runId, session);

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (claudeStreamState) {
        consumeClaudeStreamChunk(
          claudeStreamState,
          chunk,
          (text) => {
            options.emit({
              type: "delta",
              runId,
              requestKey: request.requestKey,
              text,
            });
          },
          (shell) => {
            emitShellEvent(options.emit, runId, request.requestKey, shell);
          },
          (reasoning) => {
            emitReasoningEvent(options.emit, runId, request.requestKey, reasoning);
          },
        );
        return;
      }

      if (codexStreamState) {
        consumeCodexStreamChunk(
          codexStreamState,
          chunk,
          (text) => {
            options.emit({
              type: "delta",
              runId,
              requestKey: request.requestKey,
              text,
            });
          },
          (shell) => {
            emitShellEvent(options.emit, runId, request.requestKey, shell);
          },
          (reasoning) => {
            emitReasoningEvent(options.emit, runId, request.requestKey, reasoning);
          },
        );
        return;
      }

      session.stdout += chunk;
      options.emit({
        type: "delta",
        runId,
        requestKey: request.requestKey,
        text: chunk,
      });
    });

    child.stderr?.on("data", (data: Buffer) => {
      session.stderr += data.toString();
    });

    child.on("close", (code, signal) => {
      clearTimeout(session.timeoutHandle);
      sessions.delete(runId);

      if (claudeStreamState?.buffer.trim()) {
        consumeClaudeStreamChunk(
          claudeStreamState,
          "\n",
          (text) => {
            options.emit({
              type: "delta",
              runId,
              requestKey: request.requestKey,
              text,
            });
          },
          (shell) => {
            emitShellEvent(options.emit, runId, request.requestKey, shell);
          },
          (reasoning) => {
            emitReasoningEvent(options.emit, runId, request.requestKey, reasoning);
          },
        );
      }

      if (codexStreamState?.buffer.trim()) {
        consumeCodexStreamChunk(
          codexStreamState,
          "\n",
          (text) => {
            options.emit({
              type: "delta",
              runId,
              requestKey: request.requestKey,
              text,
            });
          },
          (shell) => {
            emitShellEvent(options.emit, runId, request.requestKey, shell);
          },
          (reasoning) => {
            emitReasoningEvent(options.emit, runId, request.requestKey, reasoning);
          },
        );
      }

      if (
        claudeStreamState?.reasoningText &&
        claudeStreamState.reasoningStatus === "running"
      ) {
        claudeStreamState.reasoningStatus = "completed";
        emitReasoningEvent(options.emit, runId, request.requestKey, {
          id: "claude-thinking",
          content: claudeStreamState.reasoningText,
          status: "completed",
        });
      }

      if (session.stoppedByUser) {
        options.emit({ type: "stopped", runId, requestKey: request.requestKey });
        return;
      }

      if (signal === "SIGTERM") {
        options.emit({
          type: "failed",
          runId,
          requestKey: request.requestKey,
          error: "Command timed out. Try again or simplify your request.",
        });
        return;
      }

      if (code !== 0) {
        if (allowResumeFallback) {
          runtimeSessions.delete(requestSessionKey);
          spawnAttempt({
            runId,
            request,
            requestSessionKey,
            resumeSessionId: null,
            includeTranscript: true,
            allowResumeFallback: false,
            emitLifecycleEvents: false,
          });
          return;
        }

        const stderr = session.stderr.trim();
        const error = stderr
          ? `Agent returned an error: ${stderr}`
          : `Agent exited with code ${code}`;
        options.emit({ type: "failed", runId, requestKey: request.requestKey, error });
        return;
      }

      const text = claudeStreamState
        ? (claudeStreamState.text || claudeStreamState.finalText).trim()
        : codexStreamState
          ? codexStreamState.text.trim()
          : session.stdout.trim();
      if (!text) {
        options.emit({
          type: "failed",
          runId,
          requestKey: request.requestKey,
          error: "Received empty response from agent.",
        });
        return;
      }

      if (claudeStreamState?.sessionId) {
        runtimeSessions.set(requestSessionKey, claudeStreamState.sessionId);
        Promise.resolve(
          options.providerSessions?.set(requestSessionKey, claudeStreamState.sessionId),
        ).catch(() => {
          // Best-effort persistence; do not block UI on save failure.
        });
      }

      options.emit({
        type: "completed",
        runId,
        requestKey: request.requestKey,
        text,
        finishedAt: new Date().toISOString(),
      });
    });

    child.on("error", (err) => {
      clearTimeout(session.timeoutHandle);
      sessions.delete(runId);

      const normalized = err.message.includes("ENOENT")
        ? `Agent runtime not found. Make sure ${command} is installed and available in your PATH.`
        : err.message;

      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: normalized,
      });
    });

    if (!emitLifecycleEvents) {
      return;
    }

    if (request.draftRef) {
      options.emit({
        type: "thread-upserted",
        runId,
        requestKey: request.requestKey,
        draftId: request.draftRef.draftId,
        projectId: request.draftRef.projectId,
        thread: {
          id: request.threadId,
          title: request.draftRef.title,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    options.emit({
      type: "started",
      runId,
      requestKey: request.requestKey,
      threadId: request.threadId,
      agentId: request.agent.id,
    });
  }

  function stop(runId: string) {
    const session = sessions.get(runId);
    if (session) {
      session.stoppedByUser = true;
      session.child.kill("SIGTERM");
    }
  }

  return { start, stop };
}
