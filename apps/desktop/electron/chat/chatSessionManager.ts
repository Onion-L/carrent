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
  options: { cwd: string; timeout?: number; windowsHide?: boolean },
) => ChildProcess;

export interface ChatSessionManager {
  start: (runId: string, request: ChatTurnRequest) => void;
  stop: (runId: string) => void;
}

export function createChatSessionManager(options: {
  emit: (event: ChatRunEvent) => void;
  spawn: SpawnFn;
}): ChatSessionManager {
  const sessions = new Map<string, ChatSession>();
  const TIMEOUT_MS = 120_000;

  function start(runId: string, request: ChatTurnRequest) {
    if (!request.projectPath) {
      options.emit({
        type: "failed",
        runId,
        error: "Project path is missing. Select a project to chat.",
      });
      return;
    }

    const prompt = buildChatPrompt(request);
    const { command, args } = getRuntimeCommand(request.runtimeId, prompt);

    const child = options.spawn(command, args, {
      cwd: request.projectPath,
      windowsHide: true,
    });

    const timeoutHandle = setTimeout(() => {
      const session = sessions.get(runId);
      if (session) {
        session.child.kill("SIGTERM");
      }
    }, TIMEOUT_MS);

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
      session.stdout += chunk;
      options.emit({ type: "delta", runId, text: chunk });
    });

    child.stderr?.on("data", (data: Buffer) => {
      session.stderr += data.toString();
    });

    child.on("close", (code, signal) => {
      clearTimeout(session.timeoutHandle);
      sessions.delete(runId);

      if (session.stoppedByUser) {
        options.emit({ type: "stopped", runId });
        return;
      }

      if (signal === "SIGTERM") {
        options.emit({
          type: "failed",
          runId,
          error: "Command timed out. Try again or simplify your request.",
        });
        return;
      }

      if (code !== 0) {
        const stderr = session.stderr.trim();
        const error = stderr
          ? `Agent returned an error: ${stderr}`
          : `Agent exited with code ${code}`;
        options.emit({ type: "failed", runId, error });
        return;
      }

      const text = session.stdout.trim();
      if (!text) {
        options.emit({
          type: "failed",
          runId,
          error: "Received empty response from agent.",
        });
        return;
      }

      options.emit({
        type: "completed",
        runId,
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
        error: normalized,
      });
    });

    if (request.draftRef) {
      options.emit({
        type: "thread-upserted",
        runId,
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
