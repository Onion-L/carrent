import type { ChildProcess } from "node:child_process";
import type { ChatTurnRequest, ChatRunEvent } from "../../src/shared/chat";
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
  sessionId: string | null;
};

function createClaudeStreamState(): ClaudeStreamState {
  return {
    buffer: "",
    text: "",
    finalText: "",
    sessionId: null,
  };
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

  const text = (delta as { text?: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : null;
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

function consumeClaudeStreamChunk(
  state: ClaudeStreamState,
  chunk: string,
  onDelta: (text: string) => void,
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

      const finalText = extractClaudeFinalText(payload);
      if (finalText) {
        state.finalText = finalText;
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

export function createChatSessionManager(options: {
  emit: (event: ChatRunEvent) => void;
  spawn: SpawnFn;
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
        ? runtimeSessions.get(requestSessionKey) ?? null
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
        consumeClaudeStreamChunk(claudeStreamState, chunk, (text) => {
          options.emit({
            type: "delta",
            runId,
            requestKey: request.requestKey,
            text,
          });
        });
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
        consumeClaudeStreamChunk(claudeStreamState, "\n", (text) => {
          options.emit({
            type: "delta",
            runId,
            requestKey: request.requestKey,
            text,
          });
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

      const normalized =
        err.message.includes("ENOENT")
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
