import type { ChildProcess } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ChatReasoningEventPayload,
  ChatRunEvent,
  ChatSubagentTaskPayload,
  ChatSubagentTaskStatus,
  ChatTurnRequest,
  Attachment,
  RuntimeQuotaWindow,
  RuntimeSessionCommand,
  RuntimeSessionStatusData,
  KimiTimelineItem,
} from "../../src/shared/chat";
import {
  CHAT_PERMISSION_TIMEOUT_MS,
  buildPermissionExpiry,
  isChatPermissionOptionKind,
  type ChatPermissionAction,
  type ChatPermissionOption,
  type ChatPermissionRequest,
  type ChatPermissionResponse,
} from "../../src/shared/chatPermissions";
import {
  CHAT_QUESTION_OTHER_OPTION_ID,
  type ChatQuestionItem,
  type ChatQuestionRequest,
  type ChatQuestionResponse,
  type ChatQuestionSource,
} from "../../src/shared/chatQuestions";
import type { RuntimeMode } from "../../src/shared/runtimeMode";
import { normalizeRunChecklistEntries } from "../../src/shared/runChecklist";
import { MAX_SUBAGENT_TASK_TEXT_LENGTH } from "../../src/shared/workspacePersistence";
import type {
  CarrentBridgeFactory,
  CarrentBridgeHandle,
  CarrentBridgeMcpServerDescriptor,
} from "../bridge/carrentBridge";
import { buildChatPrompt, DEFAULT_FILE_ONLY_PROMPT, DEFAULT_IMAGE_ONLY_PROMPT } from "./chatPrompt";
import {
  QUESTION_DISMISSED_NOTE,
  QuestionAlreadyPendingError,
  type QuestionMcpServerFactory,
  type QuestionMcpServerHandle,
  type SessionQuestionInput,
  type SessionQuestionToolResult,
} from "./questionMcpServer";
import { terminateChildProcess } from "./terminateChildProcess";

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

const MAX_TOOL_OUTPUT_LENGTH = 12_000;
const MAX_TEXT_FILE_WRITE_BYTES = 4 * 1024 * 1024;
const STOP_FALLBACK_MS = 5_000;
const SUPPORTED_SESSION_COMMANDS = [
  "compact",
  "status",
] as const satisfies readonly RuntimeSessionCommand[];

class RuntimeSessionResumeError extends Error {}

export type KimiAcpTransport = {
  send: (message: JsonObject) => void;
  close: () => void | Promise<void>;
  getStderr?: () => string;
  onMessage: (listener: (message: JsonObject) => void) => void;
  onError: (listener: (error: Error) => void) => void;
  onClose: (
    listener: (details: {
      code: number | null;
      signal: NodeJS.Signals | null;
      stderr: string;
    }) => void,
  ) => void;
};

export type KimiAcpTransportFactory = (options: { cwd: string }) => KimiAcpTransport;

export type SpawnAcpProcess = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    windowsHide?: boolean;
    stdio?: ["pipe", "pipe", "pipe"];
  },
) => ChildProcess;

export type KimiAcpRunHandle = {
  stop: () => void;
  shutdown: () => Promise<void>;
  respondToPermission: (response: ChatPermissionResponse) => void;
  respondToQuestion: (response: ChatQuestionResponse) => void;
};

export class KimiRuntimeSessionError extends Error {}

function readAvailableCommandNames(update: JsonObject | null | undefined): string[] {
  const commands = Array.isArray(update?.availableCommands)
    ? update.availableCommands
    : Array.isArray(update?.commands)
      ? update.commands
      : [];
  return commands.flatMap((command) => {
    const name = readString(readObject(command)?.name);
    return name ? [name] : [];
  });
}

export async function executeKimiCompact(options: {
  sessionId: string;
  cwd: string;
  transportFactory: KimiAcpTransportFactory;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ completedAt: string }> {
  const transport = options.transportFactory({ cwd: options.cwd });
  const pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const availableCommands = new Set<string>();
  let nextId = 1;
  let settled = false;
  let phase: "initialize" | "resume" | "prompt" = "initialize";
  let receivedAvailableCommands = false;
  let availableCommandsWaiter: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  const close = () => Promise.resolve(transport.close()).catch(() => {});
  const finish = async <T>(callback: () => T) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    options.signal?.removeEventListener("abort", handleAbort);
    await close();
    return callback();
  };
  let rejectOperation: (error: Error) => void = () => {};
  const handleAbort = () => rejectOperation(new Error("Compact was interrupted."));
  const timeoutHandle = setTimeout(
    () => rejectOperation(new Error("Compact timed out after five minutes.")),
    options.timeoutMs ?? 5 * 60_000,
  );

  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      availableCommandsWaiter?.reject(error);
      availableCommandsWaiter = null;
      void finish(() => reject(error));
    };
    rejectOperation = fail;
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }

    transport.onMessage((message) => {
      if (message.id != null && pending.has(message.id as JsonRpcId)) {
        const handler = pending.get(message.id as JsonRpcId)!;
        pending.delete(message.id as JsonRpcId);
        if (message.error) {
          const errorObject = readObject(message.error);
          const detail = readString(errorObject?.message) ?? JSON.stringify(message.error);
          handler.reject(
            phase === "resume"
              ? new KimiRuntimeSessionError(
                  `Kimi Code could not resume the Runtime Session: ${detail}`,
                )
              : new Error(detail),
          );
        } else {
          handler.resolve(message.result);
        }
        return;
      }

      if (message.method !== "session/update") return;
      const params = readObject(message.params);
      const update = readObject(params?.update);
      if (readString(update?.sessionUpdate) !== "available_commands_update") return;
      receivedAvailableCommands = true;
      readAvailableCommandNames(update).forEach((name) => availableCommands.add(name));
      availableCommandsWaiter?.resolve();
      availableCommandsWaiter = null;
    });
    transport.onError(fail);
    transport.onClose(({ code, signal, stderr }) => {
      if (settled) return;
      const detail = stderr.trim() || signal || (code == null ? "unknown" : `code ${code}`);
      fail(new Error(`Kimi ACP exited before Compact completed: ${detail}`));
    });

    const request = (method: string, params: JsonObject) => {
      const id = nextId++;
      return new Promise<unknown>((requestResolve, requestReject) => {
        pending.set(id, { resolve: requestResolve, reject: requestReject });
        transport.send({ jsonrpc: "2.0", id, method, params });
      });
    };

    const waitForAvailableCommands = () => {
      if (receivedAvailableCommands) return Promise.resolve();
      return new Promise<void>((waitResolve, waitReject) => {
        availableCommandsWaiter = { resolve: waitResolve, reject: waitReject };
      });
    };

    void (async () => {
      try {
        await request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: false },
            terminal: false,
          },
        });
        phase = "resume";
        await request("session/resume", {
          sessionId: options.sessionId,
          cwd: options.cwd,
          mcpServers: [],
        });
        await waitForAvailableCommands();
        if (!availableCommands.has("compact")) {
          throw new Error("Kimi Code does not support Compact for this Runtime Session.");
        }
        phase = "prompt";
        await request("session/prompt", {
          sessionId: options.sessionId,
          prompt: [{ type: "text", text: "/compact" }],
        });
        await finish(() => resolve({ completedAt: new Date().toISOString() }));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

// A pending question resolves either an upstream ACP permission request or a
// Run-scoped MCP ask_user_question call waiting on its HTTP response.
type PendingQuestion =
  | {
      source: "native-acp";
      acpRequestId: JsonRpcId;
      options: ChatPermissionOption[];
      skipOptionId: string | null;
    }
  | {
      source: "mcp";
      items: ChatQuestionItem[];
      resolve: (result: SessionQuestionToolResult) => void;
    };

export function createKimiAcpProcessTransportFactory(
  spawn: SpawnAcpProcess,
): KimiAcpTransportFactory {
  return ({ cwd }) => createKimiAcpProcessTransport(spawn, cwd);
}

export function createKimiAcpProcessTransport(
  spawn: SpawnAcpProcess,
  cwd: string,
): KimiAcpTransport {
  const child = spawn("kimi", ["acp"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const messageListeners = new Set<(message: JsonObject) => void>();
  const errorListeners = new Set<(error: Error) => void>();
  const closeListeners = new Set<
    (details: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => void
  >();
  let stdoutBuffer = "";
  let stderr = "";
  const emitTransportError = (error: Error) => {
    errorListeners.forEach((listener) => listener(error));
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/u);
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as JsonObject;
        messageListeners.forEach((listener) => listener(parsed));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitTransportError(new Error(`Failed to parse Kimi ACP output: ${message}`));
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.stdin?.on("error", (error) => {
    emitTransportError(new Error(`Kimi ACP stdin error: ${error.message}`));
  });

  child.on("error", (error) => {
    const normalized = error.message.includes("ENOENT")
      ? 'Kimi Code runtime not found. Install Kimi Code and make "kimi" available in PATH.'
      : error.message;
    emitTransportError(new Error(normalized));
  });

  child.on("close", (code, signal) => {
    closeListeners.forEach((listener) => listener({ code, signal, stderr }));
  });

  return {
    send(message) {
      if (!child.stdin) {
        throw new Error("Kimi ACP stdin is not available.");
      }
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          emitTransportError(new Error(`Kimi ACP stdin error: ${error.message}`));
        }
      });
    },
    getStderr() {
      return stderr;
    },
    async close() {
      child.stdin?.end();
      await terminateChildProcess(child);
    },
    onMessage(listener) {
      messageListeners.add(listener);
    },
    onError(listener) {
      errorListeners.add(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
    },
  };
}

export function startKimiAcpChatRun(options: {
  runId: string;
  request: ChatTurnRequest;
  cwd: string;
  emit: (event: ChatRunEvent) => void;
  transportFactory: KimiAcpTransportFactory;
  resumeSessionId?: string | null;
  onCompletedSession?: (sessionId: string) => void | Promise<void>;
  onDone?: () => void;
  requestTimeoutMs?: number;
  bridgeFactory?: CarrentBridgeFactory | null;
  questionServerFactory?: QuestionMcpServerFactory | null;
  kimiSessionsRoot?: string;
  attachmentStoreRoot?: string;
}): KimiAcpRunHandle {
  const runner = new KimiAcpRun(options);
  void runner.start();
  return {
    stop: () => runner.stop(),
    shutdown: () => runner.shutdown(),
    respondToPermission: (response) => runner.respondToPermission(response),
    respondToQuestion: (response) => runner.respondToQuestion(response),
  };
}

export async function getKimiSessionStatus(options: {
  sessionId: string;
  cwd: string;
  transportFactory: KimiAcpTransportFactory;
  requestTimeoutMs?: number;
}): Promise<RuntimeSessionStatusData | null> {
  const { sessionId, cwd, transportFactory, requestTimeoutMs = 30_000 } = options;
  const transport = transportFactory({ cwd });

  let statusText = "";
  const availableCommands = new Set<string>();
  let nextId = 1;
  let phase: "initialize" | "resume" | "prompt" = "initialize";
  let receivedAvailableCommands = false;
  let availableCommandsWaiter: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  const pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  return new Promise((resolve, reject) => {
    const timeoutTimer = setTimeout(() => {
      const error = new Error("Timed out waiting for Kimi session status.");
      availableCommandsWaiter?.reject(error);
      availableCommandsWaiter = null;
      transport.close();
      reject(error);
    }, requestTimeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      transport.close();
    };

    transport.onMessage((message) => {
      if (message.id != null && pending.has(message.id as JsonRpcId)) {
        const handler = pending.get(message.id as JsonRpcId)!;
        pending.delete(message.id as JsonRpcId);
        if (message.error) {
          const errorObject = readObject(message.error);
          const detail = readString(errorObject?.message) ?? JSON.stringify(message.error);
          handler.reject(
            phase === "resume"
              ? new KimiRuntimeSessionError(
                  `Kimi Code could not resume the Runtime Session: ${detail}`,
                )
              : new Error(detail),
          );
        } else {
          handler.resolve(message.result);
        }
        return;
      }

      if (message.method === "session/update") {
        const payload = readObject(message.params);
        const update = readObject(payload?.update);
        const updateType = readString(update?.sessionUpdate);
        if (updateType === "available_commands_update") {
          receivedAvailableCommands = true;
          readAvailableCommandNames(update).forEach((name) => availableCommands.add(name));
          availableCommandsWaiter?.resolve();
          availableCommandsWaiter = null;
        }
        const text = readTextContent(update?.content);
        if (updateType === "agent_message_chunk" && text) {
          statusText += text;
        }
      }
    });

    transport.onError((error) => {
      availableCommandsWaiter?.reject(error);
      availableCommandsWaiter = null;
      cleanup();
      reject(error);
    });

    transport.onClose(({ stderr, signal, code }) => {
      cleanup();
      if (!statusText) {
        reject(
          new Error(
            `Kimi ACP exited before status was received: ${stderr || signal || code || "unknown"}`,
          ),
        );
        return;
      }
      resolve(parseKimiStatusText(statusText, availableCommands));
    });

    const send = (method: string, params: JsonObject): Promise<unknown> => {
      const id = nextId++;
      const message = { jsonrpc: "2.0", id, method, params };
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        transport.send(message);
      });
    };

    const waitForAvailableCommands = () => {
      if (receivedAvailableCommands) return Promise.resolve();
      return new Promise<void>((waitResolve, waitReject) => {
        availableCommandsWaiter = { resolve: waitResolve, reject: waitReject };
      });
    };

    void (async () => {
      try {
        await send("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: false },
            terminal: false,
          },
        });
        phase = "resume";
        await send("session/resume", { sessionId, cwd, mcpServers: [] });
        await waitForAvailableCommands();
        if (!availableCommands.has("status")) {
          cleanup();
          resolve(null);
          return;
        }
        phase = "prompt";
        await send("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: "/status" }],
        });
        cleanup();
        resolve(parseKimiStatusText(statusText, availableCommands));
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

function parseKimiStatusText(
  text: string,
  availableCommands: ReadonlySet<string> = new Set(),
): RuntimeSessionStatusData | null {
  const match = /Context:\s*([\d,]+)\s*\/\s*([\d,]+)\s*\(([\d.]+)%\)/u.exec(text);
  if (!match) {
    return null;
  }

  const used = Number.parseInt(match[1].replace(/,/gu, ""), 10);
  const total = Number.parseInt(match[2].replace(/,/gu, ""), 10);
  const percentage = Number.parseFloat(match[3]);
  if (
    !Number.isSafeInteger(used) ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    used < 0 ||
    used > total ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    return null;
  }
  const modelMatch = /Model:\s*(.+)/u.exec(text);
  const supportedCommands = SUPPORTED_SESSION_COMMANDS.filter((command) =>
    availableCommands.has(command),
  );
  const weekly = parseQuotaWindow(text, "Weekly");
  const fiveHour = parseQuotaWindow(text, "5h");

  return {
    model: modelMatch ? modelMatch[1].trim() : undefined,
    used,
    total,
    percentage,
    threadActions: availableCommands.has("compact") ? ["compact"] : [],
    supportedCommands,
    ...(weekly || fiveHour
      ? {
          planUsage: {
            ...(weekly ? { weekly } : {}),
            ...(fiveHour ? { fiveHour } : {}),
          },
        }
      : {}),
  };
}

function parseQuotaWindow(text: string, label: "Weekly" | "5h"): RuntimeQuotaWindow | undefined {
  const escapedLabel = label === "5h" ? "5h" : "Weekly";
  const lineMatch = new RegExp(`(?:^|\\n)\\s*-?\\s*${escapedLabel}\\s*:\\s*([^\\n]+)`, "iu").exec(
    text,
  );
  if (!lineMatch) return undefined;

  const detail = lineMatch[1].trim();
  const percentageMatch = /(?:\bused\s*:?\s*([\d.]+)%|([\d.]+)%\s*used\b)/iu.exec(detail);
  let usedPercentage: number | undefined;
  if (percentageMatch) {
    const parsed = Number.parseFloat(percentageMatch[1] ?? percentageMatch[2]);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      usedPercentage = parsed;
    }
  }

  const resetMatch = /\breset(?:s)?\s+((?:in|at)\s+.+)$/iu.exec(detail);
  const reset = resetMatch?.[1]?.trim();
  if (usedPercentage === undefined && !reset) return undefined;
  return {
    ...(usedPercentage === undefined ? {} : { usedPercentage }),
    ...(reset ? { reset } : {}),
  };
}

export async function buildKimiPromptParts(
  request: ChatTurnRequest,
  options?: { includeTranscript?: boolean },
): Promise<Array<Record<string, unknown>>> {
  const storedAttachments = request.attachments?.filter(
    (attachment): attachment is Attachment & { localPath: string } =>
      typeof attachment.localPath === "string",
  );
  const messageText =
    request.message.trim() ||
    (storedAttachments && storedAttachments.length > 0
      ? storedAttachments.some((attachment) => attachment.kind === "file")
        ? DEFAULT_FILE_ONLY_PROMPT
        : DEFAULT_IMAGE_ONLY_PROMPT
      : "");
  const parts: Array<Record<string, unknown>> = [];

  if (options?.includeTranscript === true && request.transcript.length > 0) {
    const promptRequest: ChatTurnRequest = {
      ...request,
      message: messageText,
      attachments: request.attachments?.map(({ localPath: _localPath, ...metadata }) => metadata),
    };
    parts.push({
      type: "text",
      text: buildChatPrompt(promptRequest, { includeTranscript: true }),
    });
  } else if (messageText) {
    parts.push({ type: "text", text: messageText });
  }

  for (const attachment of storedAttachments ?? []) {
    if (attachment.kind === "file") {
      parts.push({
        type: "resource_link",
        uri: pathToFileURL(attachment.localPath).toString(),
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
      });
      continue;
    }

    const data = await readFile(attachment.localPath);
    parts.push({
      type: "image",
      data: data.toString("base64"),
      mimeType: attachment.mimeType,
      uri: pathToFileURL(attachment.localPath).toString(),
    });
  }

  if (parts.length === 0) {
    parts.push({ type: "text", text: request.message });
  }

  return parts;
}

class KimiAcpRun {
  private readonly transport: KimiAcpTransport;
  private readonly pending = new Map<
    JsonRpcId,
    {
      method: string;
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  private nextId = 1;
  // Monotonic counter over received `session/update` events, used only to
  // derive unique Run-scoped ids for tool calls that arrive without a
  // toolCallId. Never reused as a fixed fallback id.
  private sessionUpdateSequence = 0;
  private sessionId: string | null = null;
  private timelineOrder = 0;
  private thinkingSegmentIndex = 0;
  private messageSegmentIndex = 0;
  private toolSequenceIndex = 0;
  private currentThinking: Extract<KimiTimelineItem, { type: "thinking" }> | null = null;
  private currentMessage: Extract<KimiTimelineItem, { type: "message" }> | null = null;
  private lastMessage: Extract<KimiTimelineItem, { type: "message" }> | null = null;
  private messageItems: Array<Extract<KimiTimelineItem, { type: "message" }>> = [];
  // Canonical Kimi tool timeline items keyed by their stabilized toolCallId.
  // Holding the item here lets a `tool_call_update` merge into the same
  // first-seen order without moving the item to the end of the timeline, and
  // keeps concurrent tool ids from overwriting one another.
  private toolItems = new Map<string, Extract<KimiTimelineItem, { type: "tool" }>>();
  // toolCallId assigned to a tool update that arrived with no id, keyed by the
  // event-sequence position it first appeared at. Lets each missing-id tool
  // receive a unique Run-scoped id instead of reusing a fixed sentinel.
  private syntheticToolIds = new Map<number, string>();
  private hasChecklistSnapshot = false;
  private pendingTodoListActivity: ChatReasoningEventPayload[] = [];
  private terminal = false;
  private finalizing = false;
  private stoppedByUser = false;
  private writtenFiles = new Set<string>();
  private stopFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private bridge: CarrentBridgeHandle | null = null;
  private lastPlanMode: boolean | null = null;
  private presentedPlanReview = false;
  private exitedPlanReviewWithoutRunning = false;
  // Canonical real path -> original display name for the current request's File
  // Attachments. Exact-match read-only allowlist; never a directory grant.
  private attachmentTargets: Map<string, string> | null = null;
  private attachmentStorePath: string | null = null;
  private attachmentStoreRealPath: string | null = null;
  private pendingPermissions = new Map<
    string,
    {
      acpRequestId: JsonRpcId;
      options: ChatPermissionOption[];
      planReview: boolean;
    }
  >();
  private pendingQuestions = new Map<string, PendingQuestion>();
  private questionServer: QuestionMcpServerHandle | null = null;
  private cleanupPromise: Promise<void> = Promise.resolve();
  private mcpQuestionCounter = 0;
  private toolStates = new Map<
    string,
    {
      title: string;
      kind: string;
      command: string;
      filePath: string;
      subagentTask?: ChatSubagentTaskPayload;
    }
  >();

  constructor(
    private readonly options: {
      runId: string;
      request: ChatTurnRequest;
      cwd: string;
      emit: (event: ChatRunEvent) => void;
      transportFactory: KimiAcpTransportFactory;
      resumeSessionId?: string | null;
      onCompletedSession?: (sessionId: string) => void | Promise<void>;
      onDone?: () => void;
      requestTimeoutMs?: number;
      bridgeFactory?: CarrentBridgeFactory | null;
      questionServerFactory?: QuestionMcpServerFactory | null;
      kimiSessionsRoot?: string;
      attachmentStoreRoot?: string;
    },
  ) {
    this.transport = options.transportFactory({ cwd: options.cwd });
    this.transport.onMessage((message) => {
      void this.handleMessage(message);
    });
    this.transport.onError((error) => {
      if (this.terminal || this.finalizing) {
        return;
      }
      if (this.stoppedByUser) {
        this.completeStopped();
        return;
      }

      this.fail(error.message);
    });
    this.transport.onClose(({ code, signal, stderr }) => {
      if (this.terminal || this.finalizing) {
        return;
      }

      if (this.stoppedByUser) {
        this.completeStopped();
        return;
      }

      const detail = stderr.trim() || signal || (code == null ? "unknown" : `code ${code}`);
      this.fail(`Kimi ACP exited before the run completed: ${detail}`);
    });
  }

  async start() {
    try {
      await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
      });

      await this.startBridge();
      if (this.terminal) {
        return;
      }
      await this.startQuestionServer();
      if (this.terminal) {
        return;
      }
      await this.prepareAttachmentTargets();
      const { configOptions, resumed } = await this.openSession();

      await this.configureModel(configOptions);
      await this.configureRuntimeMode(configOptions);

      const promptStartedAt = Date.now();
      const providerLogCursorPromise = captureKimiProviderLogCursor(
        this.sessionId!,
        this.options.kimiSessionsRoot ?? getKimiSessionsRoot(),
      );
      const promptPromise = this.request(
        "session/prompt",
        {
          sessionId: this.sessionId,
          prompt: await buildKimiPromptParts(this.options.request, {
            includeTranscript: !resumed,
          }),
        },
        { timeoutMs: null },
      );

      this.emitThreadLifecycle();

      const promptResult = readObject(await promptPromise);
      const promptError = formatKimiAcpError(readObject(promptResult?.error));
      if (promptError) {
        this.fail(promptError);
        return;
      }
      const stopReason = readString(promptResult?.stopReason);
      // Kimi currently disguises provider failures (e.g. a 403 from exhausted
      // quota) as "end_turn" — a known upstream issue — so only the values the
      // protocol can actually distinguish are handled explicitly here.
      if (stopReason === "cancelled" || this.stoppedByUser) {
        this.completeStopped();
        return;
      }

      if (stopReason === "refusal") {
        this.fail("Kimi Code declined the request (provider refusal).");
        return;
      }

      if (!stopReason) {
        const rawStopReason = promptResult?.stopReason;
        const preservedReason =
          rawStopReason === undefined
            ? "missing"
            : (JSON.stringify(rawStopReason) ?? String(rawStopReason));
        this.fail(`Kimi Code ended the run unexpectedly (stop reason: ${preservedReason}).`);
        return;
      }

      if (
        stopReason !== "end_turn" &&
        stopReason !== "max_tokens" &&
        stopReason !== "max_turn_requests"
      ) {
        this.fail(`Kimi Code ended the run unexpectedly (stop reason: ${stopReason}).`);
        return;
      }

      this.completeThinkingSegment();
      const finalText = this.markFinalMessageSegment();

      if (!finalText && !this.presentedPlanReview) {
        const providerLogCursor = await providerLogCursorPromise;
        const providerError = await readKimiProviderFailure({
          cursor: providerLogCursor,
          sessionId: this.sessionId!,
          sessionsRoot: this.options.kimiSessionsRoot ?? getKimiSessionsRoot(),
          stderr: this.transport.getStderr?.() ?? "",
          startedAt: promptStartedAt,
        });
        this.fail(
          providerError ??
            "Kimi Code returned no message. The ACP server did not provide an error detail.",
        );
        return;
      }

      await this.persistCompletedSession();

      this.complete({
        type: "completed",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        text: finalText,
        finishedAt: new Date().toISOString(),
        writtenFiles: [...this.writtenFiles],
      });
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : String(error),
        error instanceof RuntimeSessionResumeError,
      );
    }
  }

  private async prepareAttachmentTargets(): Promise<void> {
    const storedAttachments = (this.options.request.attachments ?? []).filter(
      (attachment): attachment is Attachment & { localPath: string } =>
        typeof attachment.localPath === "string",
    );
    if (storedAttachments.length === 0 && !this.options.attachmentStoreRoot) {
      return;
    }

    const attachmentStorePath = path.resolve(
      this.options.attachmentStoreRoot ?? path.dirname(storedAttachments[0]!.localPath),
    );
    let attachmentStoreRealPath: string;
    try {
      attachmentStoreRealPath = await realpath(attachmentStorePath);
    } catch {
      if (storedAttachments.length > 0) {
        throw new Error("Attachment storage is unavailable.");
      }
      attachmentStoreRealPath = await resolveCanonicalCandidatePath(attachmentStorePath);
    }

    const targets = new Map<string, string>();
    for (const attachment of storedAttachments) {
      let realPath: string;
      try {
        realPath = await realpath(attachment.localPath);
      } catch {
        throw new Error(`Attachment is unavailable: ${attachment.name}`);
      }
      if (!isContainedRelativePath(path.relative(attachmentStoreRealPath, realPath))) {
        throw new Error(`Attachment is outside managed storage: ${attachment.name}`);
      }
      if (attachment.kind === "file") {
        targets.set(realPath, attachment.name);
      }
    }
    this.attachmentStorePath = attachmentStorePath;
    this.attachmentStoreRealPath = attachmentStoreRealPath;
    this.attachmentTargets = targets;
  }

  private async openSession(): Promise<{ configOptions: unknown; resumed: boolean }> {
    const resumeSessionId = this.options.resumeSessionId ?? null;
    if (resumeSessionId) {
      try {
        this.sessionId = resumeSessionId;
        const resume = readObject(
          await this.request("session/resume", {
            sessionId: resumeSessionId,
            cwd: this.options.cwd,
            mcpServers: this.getMcpServers(),
          }),
        );
        return { configOptions: resume?.configOptions, resumed: true };
      } catch (error) {
        this.sessionId = null;
        const detail = error instanceof Error ? error.message : String(error);
        throw new RuntimeSessionResumeError(
          `Kimi Code could not resume the Runtime Session: ${detail}`,
        );
      }
    }

    const session = readObject(
      await this.request("session/new", {
        cwd: this.options.cwd,
        mcpServers: this.getMcpServers(),
      }),
    );
    this.sessionId = readString(session?.sessionId);
    if (!this.sessionId) {
      throw new Error("Kimi ACP did not return a session id.");
    }
    return { configOptions: session?.configOptions, resumed: false };
  }

  private async startBridge() {
    if (!this.options.bridgeFactory) {
      return;
    }

    const bridge = await this.options.bridgeFactory({
      runId: this.options.runId,
      cwd: this.options.cwd,
    });
    if (!bridge) {
      return;
    }
    if (this.terminal) {
      await bridge.close().catch(() => {
        // Best-effort cleanup; the run has already reached a terminal state.
      });
      return;
    }

    this.bridge = bridge;
  }

  private getMcpServers() {
    return [this.bridge?.mcpServer, this.questionServer?.mcpServer].filter(
      (server): server is CarrentBridgeMcpServerDescriptor => server !== undefined,
    );
  }

  private async startQuestionServer() {
    if (!this.options.questionServerFactory || !this.shouldStartQuestionServer()) {
      return;
    }

    const handle = await this.options.questionServerFactory({
      onAskUserQuestion: (input) => this.askUserQuestion(input),
    });
    if (!handle) {
      return;
    }
    if (this.terminal) {
      await handle.close().catch(() => {
        // Best-effort cleanup; the run has already reached a terminal state.
      });
      return;
    }

    this.questionServer = handle;
  }

  // Structured questions are only available where Kimi permits interactive
  // input: default, Plan, and YOLO runs. Kimi Auto (full-access without
  // Plan mode) runs unattended, so it gets no question server. The decision
  // uses the run's configured Carrent mode and Plan flag, not the negotiated
  // ACP mode, because the server starts before the session is configured.
  private shouldStartQuestionServer() {
    if (this.options.request.planMode) {
      return true;
    }
    return this.options.request.runtimeMode !== "full-access";
  }

  private askUserQuestion(input: SessionQuestionInput): Promise<SessionQuestionToolResult> {
    if (this.terminal) {
      return Promise.reject(new Error("The run has already ended."));
    }
    if (this.pendingQuestions.size > 0) {
      this.logQuestion("already_pending_rejected", {
        source: "mcp",
        runId: this.options.runId,
        activeQuestionId: this.pendingQuestions.keys().next().value!,
      });
      return Promise.reject(new QuestionAlreadyPendingError());
    }

    this.mcpQuestionCounter += 1;
    const questionId = `kimi-question-${this.options.runId}-mcp-${this.mcpQuestionCounter}`;
    // Option ids are prefixed per question so drafts for different questions in
    // one request never collide.
    const items: ChatQuestionItem[] = input.questions.map((question, questionIndex) => ({
      header: question.header,
      question: question.question,
      options: question.options.map((option, optionIndex) => ({
        optionId: `mcp-q${questionIndex + 1}-opt-${optionIndex + 1}`,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
      multiSelect: question.multiSelect,
    }));

    return new Promise((resolve) => {
      this.pendingQuestions.set(questionId, { source: "mcp", items, resolve });
      this.logQuestion("requested", {
        source: "mcp",
        runId: this.options.runId,
        questionId,
        questions: items.length,
      });
      this.emit({
        type: "question-requested",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        question: buildChatQuestionRequest({
          id: questionId,
          runId: this.options.runId,
          request: this.options.request,
          source: "mcp",
          questions: items,
        }),
      });
    });
  }

  private async persistCompletedSession() {
    if (!this.sessionId) {
      return;
    }

    try {
      await this.options.onCompletedSession?.(this.sessionId);
    } catch {
      // Best-effort persistence; do not fail a completed Kimi turn on save errors.
    }
  }

  private async configureModel(configOptions: unknown) {
    const selectedModelId = this.options.request.runtimeModelId;
    if (!selectedModelId) {
      return;
    }

    const modelConfig = findModelConfigOption(configOptions);
    if (!modelConfig) {
      throw new Error(
        `Kimi Code did not expose a model configuration option. Clear the selected model or choose a Kimi-supported model.`,
      );
    }

    if (readString(modelConfig.currentValue) === selectedModelId) {
      return;
    }

    const supportedValues = readConfigOptionValues(modelConfig.options);
    if (!supportedValues.includes(selectedModelId)) {
      throw new Error(
        `Kimi Code does not list selected model "${selectedModelId}". Clear it or choose a Kimi-supported model.`,
      );
    }

    await this.request("session/set_config_option", {
      sessionId: this.sessionId!,
      configId: readString(modelConfig.id) ?? "model",
      value: selectedModelId,
    });
  }

  private async configureRuntimeMode(configOptions: unknown) {
    const selectedMode = this.options.request.planMode
      ? "plan"
      : getKimiModeValue(this.options.request.runtimeMode);
    const modeConfig = findModeConfigOption(configOptions);

    if (!modeConfig) {
      if (selectedMode === "default") {
        return;
      }

      throw new Error(
        this.options.request.planMode
          ? "Kimi Code did not expose Plan Mode. Update Kimi Code or remove Plan mode."
          : "Kimi Code did not expose a mode configuration option. Use Approval required or update Kimi Code.",
      );
    }

    if (readString(modeConfig.currentValue) === selectedMode) {
      return;
    }

    const supportedValues = readConfigOptionValues(modeConfig.options);
    if (!supportedValues.includes(selectedMode)) {
      throw new Error(
        selectedMode === "plan"
          ? "Kimi Code does not list Plan Mode. Update Kimi Code or remove Plan mode."
          : `Kimi Code does not list mode "${selectedMode}". Use a supported runtime permission mode.`,
      );
    }

    await this.request("session/set_config_option", {
      sessionId: this.sessionId!,
      configId: readString(modeConfig.id) ?? "mode",
      value: selectedMode,
    });
  }

  stop() {
    if (this.terminal) {
      return;
    }

    this.stoppedByUser = true;
    if (this.sessionId) {
      try {
        this.notify("session/cancel", { sessionId: this.sessionId });
      } catch {
        this.completeStopped();
        return;
      }
      this.stopFallbackTimer ??= setTimeout(() => {
        this.completeStopped();
      }, STOP_FALLBACK_MS);
      return;
    }

    this.completeStopped();
  }

  // App shutdown ends the run immediately: no session/cancel grace period, but
  // the same terminal cleanup (question server flush, transport close).
  async shutdown() {
    if (!this.terminal) {
      this.stoppedByUser = true;
      this.completeStopped();
    }

    await this.cleanupPromise;
  }

  respondToPermission(response: ChatPermissionResponse) {
    if (response.runId !== this.options.runId) {
      return;
    }

    const pendingPermission = this.pendingPermissions.get(response.permissionId);
    if (!pendingPermission) {
      this.emitPermissionFailed(
        response.permissionId,
        "Permission request not found. The run may have already ended.",
      );
      return;
    }

    const selectedOption = pendingPermission.options.find(
      (option) => option.optionId === response.optionId,
    );
    if (!selectedOption) {
      this.emitPermissionFailed(response.permissionId, "Permission option is no longer available.");
      return;
    }

    if (pendingPermission.planReview) {
      this.exitedPlanReviewWithoutRunning = selectedOption.optionId === "plan_reject_and_exit";
    }

    try {
      this.respond(pendingPermission.acpRequestId, {
        outcome: {
          outcome: "selected",
          optionId: selectedOption.optionId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitPermissionFailed(response.permissionId, message);
      this.fail(message);
      return;
    }

    this.pendingPermissions.delete(response.permissionId);
    this.emit({
      type: "permission-resolved",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      permissionId: response.permissionId,
      optionId: selectedOption.optionId,
      optionName: selectedOption.name,
      optionKind: selectedOption.kind,
    });
  }

  respondToQuestion(response: ChatQuestionResponse) {
    if (response.runId !== this.options.runId) {
      this.logQuestion("response_rejected", {
        runId: response.runId,
        questionId: response.questionId,
        reason: "wrong_run",
      });
      return;
    }

    const pendingQuestion = this.pendingQuestions.get(response.questionId);
    if (!pendingQuestion) {
      this.logQuestion("response_rejected", {
        runId: response.runId,
        questionId: response.questionId,
        reason: "not_found",
      });
      this.emitQuestionFailed(
        response.questionId,
        "Question request not found. The run may have already ended.",
      );
      return;
    }

    if (pendingQuestion.source === "mcp") {
      this.respondToMcpQuestion(response, pendingQuestion);
      return;
    }

    const submitAnswer =
      response.action === "submit"
        ? response.answers.length === 1 &&
          response.answers[0]!.questionIndex === 0 &&
          response.answers[0]!.optionIds.length === 1
          ? response.answers[0]!
          : null
        : null;

    if (response.action === "submit" && (!submitAnswer || submitAnswer.customText !== undefined)) {
      this.emitQuestionFailed(
        response.questionId,
        "Native Kimi ACP questions support exactly one predefined answer.",
      );
      return;
    }

    if (response.action === "skip") {
      const skipOption = pendingQuestion.options.find(
        (option) => option.optionId === pendingQuestion.skipOptionId,
      );
      try {
        this.respond(
          pendingQuestion.acpRequestId,
          skipOption
            ? { outcome: { outcome: "selected", optionId: skipOption.optionId } }
            : { outcome: { outcome: "cancelled" } },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emitQuestionFailed(response.questionId, message);
        this.fail(message);
        return;
      }

      this.pendingQuestions.delete(response.questionId);
      this.logQuestion("resolved", {
        source: "native-acp",
        runId: this.options.runId,
        questionId: response.questionId,
        outcome: "skipped",
      });
      this.emit({
        type: "question-resolved",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        questionId: response.questionId,
        outcome: "skipped",
        ...(skipOption ? { optionId: skipOption.optionId, optionLabel: skipOption.name } : {}),
      });
      return;
    }

    const selectedOption = pendingQuestion.options.find(
      (option) => option.optionId === submitAnswer!.optionIds[0],
    );
    if (!selectedOption) {
      this.emitQuestionFailed(response.questionId, "Question option is no longer available.");
      return;
    }

    try {
      this.respond(pendingQuestion.acpRequestId, {
        outcome: {
          outcome: "selected",
          optionId: selectedOption.optionId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitQuestionFailed(response.questionId, message);
      this.fail(message);
      return;
    }

    this.pendingQuestions.delete(response.questionId);
    this.logQuestion("resolved", {
      source: "native-acp",
      runId: this.options.runId,
      questionId: response.questionId,
      outcome: "answered",
    });
    this.emit({
      type: "question-resolved",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      questionId: response.questionId,
      outcome: "answered",
      optionId: selectedOption.optionId,
      optionLabel: selectedOption.name,
    });
  }

  private respondToMcpQuestion(
    response: ChatQuestionResponse,
    pendingQuestion: Extract<PendingQuestion, { source: "mcp" }>,
  ) {
    const items = pendingQuestion.items;

    if (response.action === "skip") {
      pendingQuestion.resolve({ answers: {}, note: QUESTION_DISMISSED_NOTE });
      this.pendingQuestions.delete(response.questionId);
      this.logQuestion("resolved", {
        source: "mcp",
        runId: this.options.runId,
        questionId: response.questionId,
        outcome: "skipped",
      });
      this.emit({
        type: "question-resolved",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        questionId: response.questionId,
        outcome: "skipped",
      });
      return;
    }

    // Re-derive the Kimi answers object defensively; the renderer already
    // enforces selection and Other-text rules.
    const answersByIndex = new Map<number, (typeof response.answers)[number]>();
    for (const answer of response.answers) {
      if (
        !Number.isInteger(answer.questionIndex) ||
        answer.questionIndex < 0 ||
        answer.questionIndex >= items.length ||
        answersByIndex.has(answer.questionIndex)
      ) {
        this.emitQuestionFailed(
          response.questionId,
          "Question answers do not match the pending questions.",
        );
        return;
      }
      answersByIndex.set(answer.questionIndex, answer);
    }

    if (answersByIndex.size !== items.length) {
      this.emitQuestionFailed(response.questionId, "Every question requires an answer.");
      return;
    }

    const answers: Record<string, string> = {};
    for (const [index, item] of items.entries()) {
      const answer = answersByIndex.get(index)!;
      // Single-select questions accept exactly one selection; Other is only
      // valid on its own. Multi-select may combine Other with predefined
      // choices.
      if (!item.multiSelect && answer.optionIds.length !== 1) {
        this.emitQuestionFailed(
          response.questionId,
          "Single-select questions require exactly one selected option.",
        );
        return;
      }

      const parts: string[] = [];
      for (const optionId of answer.optionIds) {
        if (optionId === CHAT_QUESTION_OTHER_OPTION_ID) {
          continue;
        }
        const option = item.options.find((candidate) => candidate.optionId === optionId);
        if (!option) {
          this.emitQuestionFailed(response.questionId, "Question option is no longer available.");
          return;
        }
        parts.push(option.label);
      }

      const hasOther = answer.optionIds.includes(CHAT_QUESTION_OTHER_OPTION_ID);
      const customText = answer.customText?.trim();
      if (hasOther) {
        if (!customText) {
          this.emitQuestionFailed(response.questionId, "The Other answer requires custom text.");
          return;
        }
        parts.push(customText);
      }

      if (parts.length === 0) {
        this.emitQuestionFailed(response.questionId, "Every question requires an answer.");
        return;
      }

      answers[item.question] = parts.join(", ");
    }

    pendingQuestion.resolve({ answers });
    this.pendingQuestions.delete(response.questionId);
    this.logQuestion("resolved", {
      source: "mcp",
      runId: this.options.runId,
      questionId: response.questionId,
      outcome: "answered",
    });

    // Keep the single-question summary fields for the common case; a
    // multi-question resolution has no single selected option to report.
    const onlyAnswer = response.answers.length === 1 ? response.answers[0]! : null;
    const summary =
      items.length === 1 && onlyAnswer && onlyAnswer.optionIds.length === 1
        ? {
            optionId: onlyAnswer.optionIds[0]!,
            optionLabel: answers[items[0]!.question]!,
          }
        : {};

    this.emit({
      type: "question-resolved",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      questionId: response.questionId,
      outcome: "answered",
      ...summary,
    });
  }

  private request(
    method: string,
    params: JsonObject,
    options: { timeoutMs?: number | null } = {},
  ): Promise<unknown> {
    const id = this.nextId++;
    const timeoutMs =
      "timeoutMs" in options ? options.timeoutMs : (this.options.requestTimeoutMs ?? 30_000);

    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs == null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Timed out waiting for Kimi ACP ${method}.`));
            }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.transport.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: JsonObject) {
    this.transport.send({ jsonrpc: "2.0", method, params });
  }

  private async handleMessage(message: JsonObject) {
    if (this.terminal || this.finalizing) {
      return;
    }

    if (message.method && message.id != null) {
      await this.handleAgentRequest(message);
      return;
    }

    if (message.id != null && this.pending.has(message.id as JsonRpcId)) {
      const pending = this.pending.get(message.id as JsonRpcId)!;
      this.pending.delete(message.id as JsonRpcId);
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      if (pending.method === "session/prompt") {
        this.finalizing = true;
      }

      const error = readObject(message.error);
      if (error) {
        pending.reject(new Error(formatKimiAcpError(error) ?? JSON.stringify(error)));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if (message.method === "session/update") {
      this.handleSessionUpdate(message.params);
    }
  }

  private async handleAgentRequest(message: JsonObject) {
    const id = message.id as JsonRpcId;
    const method = readString(message.method);

    try {
      if (method === "fs/read_text_file") {
        await this.respond(id, await this.handleReadTextFile(message.params));
        return;
      }

      if (method === "fs/write_text_file") {
        await this.respond(id, await this.handleWriteTextFile(message.params));
        return;
      }

      if (method === "session/request_permission") {
        await this.handlePermissionRequest(id, message.params);
        return;
      }

      await this.respondError(id, {
        code: -32601,
        message: `Unsupported Kimi ACP client method: ${method ?? "unknown"}`,
      });
    } catch (error) {
      await this.respondError(id, {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handlePermissionRequest(id: JsonRpcId, params: unknown) {
    const payload = readObject(params);
    const options = readPermissionOptions(payload?.options);
    if (options.length === 0) {
      await this.respond(id, { outcome: { outcome: "cancelled" } });
      if (isKimiQuestionToolCall(payload)) {
        // A malformed question request must not terminate the Run; the agent
        // gets the cancellation and can recover.
        this.emitQuestionFailed(
          `kimi-question-${this.options.runId}-${String(id)}`,
          "Kimi question request did not include any supported response options.",
        );
        return;
      }
      this.fail("Kimi requested permission without any supported response options.");
      return;
    }

    if (isKimiQuestionToolCall(payload)) {
      await this.handleQuestionRequest(id, params, options);
      return;
    }

    const permission = buildKimiPermissionRequest({
      id,
      runId: this.options.runId,
      request: this.options.request,
      params,
      permissionOptions: options,
    });
    this.pendingPermissions.set(permission.id, {
      acpRequestId: id,
      options,
      planReview: !!permission.planReview,
    });
    this.emit({
      type: "permission-requested",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      permission,
    });

    if (permission.planReview) {
      this.presentedPlanReview = true;
    }
  }

  private async handleQuestionRequest(
    id: JsonRpcId,
    params: unknown,
    options: ChatPermissionOption[],
  ) {
    // One pending question per Run across both entry points: cancel the second
    // native ACP request upstream without touching the active panel.
    if (this.pendingQuestions.size > 0) {
      await this.respond(id, { outcome: { outcome: "cancelled" } });
      this.logQuestion("already_pending_rejected", {
        source: "native-acp",
        runId: this.options.runId,
        activeQuestionId: this.pendingQuestions.keys().next().value!,
      });
      return;
    }

    const question = buildKimiQuestionRequest({
      id,
      runId: this.options.runId,
      request: this.options.request,
      params,
      permissionOptions: options,
    });
    if (!question) {
      await this.respond(id, { outcome: { outcome: "cancelled" } });
      // A malformed question request must not terminate the Run; the agent
      // gets the cancellation and can recover.
      this.emitQuestionFailed(
        `kimi-question-${this.options.runId}-${String(id)}`,
        "Kimi question request did not include a supported question.",
      );
      return;
    }

    this.pendingQuestions.set(question.id, {
      source: "native-acp",
      acpRequestId: id,
      options,
      skipOptionId: question.skipOptionId ?? null,
    });
    this.logQuestion("requested", {
      source: "native-acp",
      runId: this.options.runId,
      questionId: question.id,
      questions: question.questions.length,
    });
    this.emit({
      type: "question-requested",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      question,
    });
  }

  private async handleReadTextFile(params: unknown) {
    const payload = readObject(params);
    const requestedPath = readString(payload?.path);
    if (!requestedPath) {
      throw new Error("Kimi ACP requested a file without a path.");
    }

    const target = await this.resolveTextFileTarget(requestedPath, "read");

    if (target.kind === "project") {
      this.emit({
        type: "reasoning",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        reasoning: {
          id: `kimi-fs-read-${target.path}`,
          content: `Read ${target.relativePath || path.basename(target.path)}`,
          status: "completed",
        },
      });
    }

    if (target.kind === "attachment") {
      this.emit({
        type: "reasoning",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        reasoning: {
          id: `kimi-fs-read-attachment-${target.name}`,
          content: `Read ${target.name}`,
          status: "completed",
        },
      });
    }

    return { content: await readFile(target.path, "utf8") };
  }

  private async handleWriteTextFile(params: unknown) {
    const payload = readObject(params);
    const requestedPath = readString(payload?.path);
    const content = typeof payload?.content === "string" ? payload.content : null;
    if (!requestedPath || content === null) {
      throw new Error("Kimi ACP requested an invalid text-file write.");
    }
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_WRITE_BYTES) {
      throw new Error("Kimi ACP text-file write is too large.");
    }

    const target = await this.resolveTextFileTarget(requestedPath, "write");
    await mkdir(path.dirname(target.path), { recursive: true });
    await writeFile(target.path, content, "utf8");
    if (target.kind === "project" && target.relativePath) {
      this.writtenFiles.add(target.relativePath.split(path.sep).join("/"));
    }
    return {};
  }

  private async resolveTextFileTarget(requestedPath: string, access: "read" | "write") {
    const resolvedPath = path.resolve(this.options.cwd, requestedPath);

    if (this.attachmentStorePath && this.attachmentStoreRealPath && this.attachmentTargets) {
      const candidateRealPath = await resolveCanonicalCandidatePath(resolvedPath);
      const isInAttachmentStore =
        isContainedRelativePath(path.relative(this.attachmentStorePath, resolvedPath)) ||
        isContainedRelativePath(path.relative(this.attachmentStoreRealPath, candidateRealPath));

      if (isInAttachmentStore) {
        const attachmentName = this.attachmentTargets.get(candidateRealPath);
        if (access === "read" && attachmentName !== undefined) {
          return {
            kind: "attachment" as const,
            path: candidateRealPath,
            relativePath: "",
            name: attachmentName,
          };
        }
        throw new Error(`Refusing to ${access} attachment storage: ${requestedPath}`);
      }
    }

    const projectWorkingDirectory = path.resolve(this.options.cwd);
    const projectWorkingDirectoryRealPath = await realpath(this.options.cwd);
    const projectRelativePath = path.relative(projectWorkingDirectory, resolvedPath);
    const isLexicallyInProject = isContainedRelativePath(projectRelativePath);

    if (isLexicallyInProject) {
      const targetPath = await resolveContainedTextFilePath({
        targetPath: resolvedPath,
        rootRealPath: projectWorkingDirectoryRealPath,
        access,
        refusalMessage: `Refusing to ${access} outside Project Working Directory: ${requestedPath}`,
      });
      return {
        kind: "project" as const,
        path: targetPath,
        relativePath: projectRelativePath,
      };
    }

    const sessionsRoot = this.options.kimiSessionsRoot ?? getKimiSessionsRoot();
    if (!this.sessionId || !isCurrentKimiPlanPath(resolvedPath, this.sessionId, sessionsRoot)) {
      throw new Error(`Refusing to ${access} outside Project Working Directory: ${requestedPath}`);
    }

    const sessionsRootRealPath = await realpath(sessionsRoot);
    const targetPath = await resolveContainedTextFilePath({
      targetPath: resolvedPath,
      rootRealPath: sessionsRootRealPath,
      access,
      refusalMessage: `Refusing to ${access} outside Kimi plan storage: ${requestedPath}`,
    });

    return {
      kind: "plan" as const,
      path: targetPath,
      relativePath: "",
    };
  }

  private respond(id: JsonRpcId, result: unknown) {
    this.transport.send({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: JsonRpcId, error: JsonObject) {
    this.transport.send({ jsonrpc: "2.0", id, error });
  }

  private handleSessionUpdate(params: unknown) {
    const payload = readObject(params);
    const update = readObject(payload?.update);
    const updateType = readString(update?.sessionUpdate);
    const text = readTextContent(update?.content);
    this.sessionUpdateSequence += 1;

    if (updateType === "config_option_update") {
      const modeConfig = findModeConfigOption(update?.configOptions);
      const currentMode = readString(modeConfig?.currentValue);
      if (currentMode) {
        this.emitPlanModeChanged(currentMode === "plan");
      }
      return;
    }

    if (updateType === "agent_message_chunk") {
      this.completeThinkingSegment();
      if (this.exitedPlanReviewWithoutRunning) {
        return;
      }
      if (!text) return;
      if (!this.currentMessage) {
        this.messageSegmentIndex += 1;
        this.currentMessage = {
          type: "message",
          id: `kimi-${this.options.runId}-message-${this.messageSegmentIndex}`,
          order: this.timelineOrder++,
          content: "",
          isFinal: false,
        };
      }
      this.currentMessage = {
        ...this.currentMessage,
        content: this.currentMessage.content + text,
      };
      const messageIndex = this.messageItems.findIndex(
        (item) => item.id === this.currentMessage!.id,
      );
      if (messageIndex >= 0) {
        this.messageItems[messageIndex] = this.currentMessage;
      } else {
        this.messageItems.push(this.currentMessage);
      }
      this.lastMessage = this.currentMessage;
      this.emitKimiTimelineItem(this.currentMessage);
      this.emit({
        type: "delta",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        text,
      });
      return;
    }

    if (updateType === "agent_thought_chunk" && text) {
      this.currentMessage = null;
      if (!this.currentThinking) {
        this.thinkingSegmentIndex += 1;
        this.currentThinking = {
          type: "thinking",
          id: `kimi-${this.options.runId}-thinking-${this.thinkingSegmentIndex}`,
          order: this.timelineOrder++,
          content: "",
          status: "running",
        };
      }
      this.currentThinking = {
        ...this.currentThinking,
        content: this.currentThinking.content + text,
      };
      this.emitKimiTimelineItem(this.currentThinking);
      return;
    }

    if (updateType === "plan") {
      this.completeThinkingSegment();
      this.currentMessage = null;
      const entries = normalizeRunChecklistEntries(update?.entries);
      if (entries) {
        this.hasChecklistSnapshot = entries.length > 0;
        if (this.hasChecklistSnapshot) {
          this.pendingTodoListActivity = [];
        }
        this.emit({
          type: "checklist",
          runId: this.options.runId,
          requestKey: this.options.request.requestKey,
          threadId: this.options.request.threadId,
          runtimeId: this.options.request.runtimeId,
          checklist: { entries },
        });
      }
      return;
    }

    if ((updateType === "tool_call" || updateType === "tool_call_update") && update) {
      this.completeThinkingSegment();
      this.currentMessage = null;
      this.handleToolUpdate(update);
    }
  }

  private handleToolUpdate(update: JsonObject) {
    const toolCallId = this.resolveToolCallId(update);
    const existingState = this.toolStates.get(toolCallId);
    const rawInput = readObject(update.rawInput);
    const content = readTextContent(update.content);
    const parsedContent = parseJsonObject(content);
    const title = readString(update.title) ?? existingState?.title ?? "Kimi tool";
    const kind = readString(update.kind) ?? existingState?.kind ?? "";
    const command =
      readString(rawInput?.command) ??
      readString(parsedContent?.command) ??
      existingState?.command ??
      commandFromTitle(title) ??
      "";
    const filePath =
      readString(rawInput?.path) ??
      readString(rawInput?.file_path) ??
      readString(parsedContent?.path) ??
      readString(parsedContent?.file_path) ??
      existingState?.filePath ??
      "";

    this.toolStates.set(toolCallId, {
      title,
      kind,
      command,
      filePath,
      subagentTask: existingState?.subagentTask,
    });
    const acpStatus = normalizeToolStatus(readString(update.status));
    const output = getToolOutput(update, content);
    const input = readToolInput(rawInput, content);
    const error = acpStatus === "failed" ? output : "";

    this.handleSubagentTask(toolCallId, update, rawInput, title, acpStatus);

    if (acpStatus !== "running") {
      if (title === "EnterPlanMode" && output.includes("Plan mode is now active")) {
        this.emitPlanModeChanged(true);
      }
      if (title === "ExitPlanMode") {
        if (output.includes("Plan mode deactivated")) {
          this.emitPlanModeChanged(false);
        } else if (output.includes("Plan mode remains active")) {
          this.emitPlanModeChanged(true);
        }
      }
    }

    if (title === "ExitPlanMode" && this.presentedPlanReview) {
      return;
    }

    // TodoList drives the Run Checklist surface; when no checklist snapshot
    // exists its activity still feeds the legacy reasoning activity trail. The
    // tool timeline item below is emitted in addition so TodoList uses the same
    // unified timeline contract as shell and generic tools.
    const reasoning: ChatReasoningEventPayload = {
      id: `kimi-tool-${toolCallId}`,
      content: describeToolActivity(title, kind, filePath),
      status: acpStatus === "running" ? "running" : "completed",
    };
    if (title === "TodoList" && !this.hasChecklistSnapshot) {
      this.pendingTodoListActivity.push(reasoning);
      if (acpStatus !== "running") {
        this.flushPendingTodoListActivity();
      }
    }

    this.emitToolTimelineItem(toolCallId, {
      title,
      kind,
      command,
      filePath,
      input,
      output: truncateToolOutput(output),
      error,
      status: kimiToolTimelineStatus(readString(update.status)),
    });
  }

  // Returns the stable ACP toolCallId for an update. Updates without an id
  // receive a unique Run-scoped synthetic id derived from the event sequence,
  // so parallel missing-id tools never collide and no fixed fallback id is
  // reused.
  private resolveToolCallId(update: JsonObject): string {
    const explicit = readString(update.toolCallId);
    if (explicit) {
      return explicit;
    }

    const sequence = this.sessionUpdateSequence;
    const existing = this.syntheticToolIds.get(sequence);
    if (existing) {
      return existing;
    }

    this.toolSequenceIndex += 1;
    const synthetic = `kimi-${this.options.runId}-tool-${this.toolSequenceIndex}`;
    this.syntheticToolIds.set(sequence, synthetic);
    return synthetic;
  }

  // Upserts the canonical tool timeline item for `toolCallId`. The first
  // sighting assigns a stable order; later updates only change content and
  // status and never move the item or change its id. A completed or failed tool
  // cannot be flipped back to running by an ordinary later update.
  private emitToolTimelineItem(
    toolCallId: string,
    fields: {
      title: string;
      kind: string;
      command: string;
      filePath: string;
      input: string;
      output: string;
      error: string;
      status: Extract<KimiTimelineItem, { type: "tool" }>["status"];
    },
  ) {
    const existing = this.toolItems.get(toolCallId);
    const order = existing?.order ?? this.timelineOrder++;
    const previousStatus = existing?.status;
    // A tool that already reached a terminal state stays there; only richer
    // content is filled in. This keeps history from regressing when a stray
    // late update arrives.
    const status =
      previousStatus === "completed" ||
      previousStatus === "failed" ||
      previousStatus === "cancelled"
        ? previousStatus
        : fields.status;
    const item: Extract<KimiTimelineItem, { type: "tool" }> = {
      type: "tool",
      id: existing?.id ?? `kimi-${this.options.runId}-tool-item-${order}`,
      order,
      toolCallId,
      title: fields.title || existing?.title || "Kimi tool",
      kind: fields.kind || existing?.kind || "",
      command: fields.command || existing?.command || "",
      filePath: fields.filePath || existing?.filePath || "",
      input: fields.input || existing?.input || "",
      output: fields.output || existing?.output || "",
      error: fields.error || existing?.error || "",
      status,
    };
    this.toolItems.set(toolCallId, item);
    this.emitKimiTimelineItem(item);
  }

  private handleSubagentTask(
    id: string,
    update: JsonObject,
    rawInput: JsonObject | null,
    title: string,
    status: "running" | "completed" | "failed",
  ) {
    const state = this.toolStates.get(id);
    if (!state) {
      return;
    }

    let task = state.subagentTask;
    if (!task) {
      const start = matchKimiSubagentStart(title, rawInput);
      if (!start) {
        return;
      }

      task = {
        id,
        runtimeId: "kimi",
        source: start.source,
        agentType: start.agentType,
        agentCount:
          start.source === "agent-swarm" && start.agentCount > 0 ? start.agentCount : undefined,
        description: truncateSubagentTaskText(start.description),
        prompt:
          start.source === "agent" && start.prompt
            ? truncateSubagentTaskText(start.prompt)
            : undefined,
        background: start.background,
        status: "running",
        startedAt: Date.now(),
      };
      state.subagentTask = task;
      this.emitSubagentTask(task);
      if (status === "running") {
        return;
      }
    }

    const content = readTextContent(update.content);
    const resultText = extractSubagentResultText(update, content);
    const result = task.source === "agent" ? parseKimiAgentResult(resultText) : null;

    let nextStatus: ChatSubagentTaskStatus = task.status;
    if (status === "failed" || result?.status === "failed") {
      nextStatus = "failed";
    } else if (status === "completed") {
      if (task.background && result?.status !== "completed") {
        // Only a parsed completed result confirms a background call finished.
        // A still-running or unparseable result detaches instead of being
        // claimed completed; AgentSwarm results are never parsed.
        nextStatus = "detached";
      } else {
        nextStatus = "completed";
      }
    }

    const settles =
      (nextStatus === "completed" || nextStatus === "failed" || nextStatus === "detached") &&
      task.finishedAt === undefined;

    task = {
      ...task,
      runtimeAgentId: result?.runtimeAgentId ?? task.runtimeAgentId,
      agentType: result?.agentType ?? task.agentType,
      summary: result?.summary ? truncateSubagentTaskText(result.summary) : task.summary,
      status: nextStatus,
      finishedAt: settles ? Date.now() : task.finishedAt,
    };
    state.subagentTask = task;
    this.emitSubagentTask(task);
  }

  private emitSubagentTask(task: ChatSubagentTaskPayload) {
    this.emit({
      type: "subagent-task",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      task,
    });
  }

  private emitPlanModeChanged(enabled: boolean) {
    if (this.lastPlanMode === enabled) {
      return;
    }
    this.lastPlanMode = enabled;
    this.emit({
      type: "plan-mode-changed",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      enabled,
    });
  }

  private completeThinkingSegment() {
    if (!this.currentThinking) {
      return;
    }

    this.emitKimiTimelineItem({ ...this.currentThinking, status: "completed" });
    this.currentThinking = null;
  }

  private cancelRunningTimelineItems() {
    this.toolItems.forEach((item, toolCallId) => {
      if (item.status !== "running") {
        return;
      }
      const cancelled = { ...item, status: "cancelled" as const };
      this.toolItems.set(toolCallId, cancelled);
      this.emitKimiTimelineItem(cancelled);
    });

    if (this.currentThinking) {
      this.emitKimiTimelineItem({ ...this.currentThinking, status: "cancelled" });
      this.currentThinking = null;
    }
  }

  private markFinalMessageSegment() {
    if (!this.lastMessage) return "";
    this.lastMessage = { ...this.lastMessage, isFinal: true };
    const messageIndex = this.messageItems.findIndex((item) => item.id === this.lastMessage!.id);
    if (messageIndex >= 0) {
      this.messageItems[messageIndex] = this.lastMessage;
    } else {
      this.messageItems.push(this.lastMessage);
    }
    this.emitKimiTimelineItem(this.lastMessage);
    return this.messageItems
      .filter((item) => item.isFinal)
      .sort((left, right) => left.order - right.order)
      .map((item) => item.content)
      .join("\n")
      .trim();
  }

  private emitKimiTimelineItem(item: KimiTimelineItem) {
    // The normalized Kimi timeline is a distinct channel from the legacy
    // reasoning/shell activity trail. Emit it directly so publishing a
    // timeline item does not drain the TodoList reasoning deferral queue,
    // which is gated on Run Checklist snapshots arriving in order.
    if (this.terminal) {
      return;
    }
    this.options.emit({
      type: "kimi-timeline",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      item,
    });
  }

  private emitThreadLifecycle() {
    this.emit({
      type: "started",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      threadId: this.options.request.threadId,
    });
  }

  private emit(event: ChatRunEvent) {
    if (!this.terminal) {
      this.flushPendingTodoListActivity();
      this.options.emit(event);
    }
  }

  // Diagnostic lifecycle log: ids, sources, outcomes, and counts only — never
  // free-text answer contents.
  private logQuestion(action: string, details: Record<string, string | number>) {
    const suffix = Object.entries(details)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    console.info(`[chat:question] ${action}${suffix ? ` ${suffix}` : ""}`);
  }

  private fail(error: string, runtimeSessionRecovery = false) {
    this.complete({
      type: "failed",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      error,
      writtenFiles: [...this.writtenFiles],
      ...(runtimeSessionRecovery
        ? {
            runtimeSessionRecovery: {
              runtimeId: this.options.request.runtimeId,
              threadId: this.options.request.threadId,
            },
          }
        : {}),
    });
  }

  private emitPermissionFailed(permissionId: string, error: string) {
    this.emit({
      type: "permission-failed",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      permissionId,
      error,
    });
  }

  private emitQuestionFailed(questionId: string, error: string) {
    this.emit({
      type: "question-failed",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      questionId,
      error,
    });
  }

  private completeStopped() {
    this.complete({
      type: "stopped",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      writtenFiles: [...this.writtenFiles],
    });
  }

  private complete(event: ChatRunEvent) {
    if (this.terminal) {
      return;
    }

    this.cancelRunningTimelineItems();
    this.flushPendingTodoListActivity();
    this.terminal = true;
    if (this.stopFallbackTimer) {
      clearTimeout(this.stopFallbackTimer);
      this.stopFallbackTimer = null;
    }
    this.pending.forEach((pending) => {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    });
    this.pending.clear();
    this.pendingPermissions.clear();
    this.pendingQuestions.forEach((question, questionId) => {
      this.logQuestion("interrupted", {
        source: question.source,
        runId: this.options.runId,
        questionId,
        reason: event.type,
      });
    });
    this.pendingQuestions.clear();
    this.options.emit(event);
    this.cleanupPromise = Promise.all([
      this.closeBridge(),
      this.closeQuestionServer(),
      Promise.resolve(this.transport.close()),
    ]).then(() => undefined);
    void this.cleanupPromise.catch(() => {});
    this.options.onDone?.();
  }

  private flushPendingTodoListActivity() {
    if (this.hasChecklistSnapshot) {
      this.pendingTodoListActivity = [];
      return;
    }

    this.pendingTodoListActivity.forEach((reasoning) => {
      this.options.emit({
        type: "reasoning",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        reasoning,
      });
    });
    this.pendingTodoListActivity = [];
  }

  private closeBridge(): Promise<void> {
    const bridge = this.bridge;
    this.bridge = null;
    if (!bridge) {
      return Promise.resolve();
    }

    return bridge.close().catch(() => {
      // Best-effort cleanup; the run has already reached a terminal state.
    });
  }

  private closeQuestionServer(): Promise<void> {
    const questionServer = this.questionServer;
    this.questionServer = null;
    if (!questionServer) {
      return Promise.resolve();
    }

    return questionServer.close().catch(() => {
      // Best-effort cleanup; the run has already reached a terminal state.
    });
  }
}

function readObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPermissionOptions(value: unknown): ChatPermissionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options = value.flatMap((item) => {
    const option = readObject(item);
    const optionId = readString(option?.optionId);
    const name = readString(option?.name);
    const kind = readString(option?.kind);
    if (!optionId || !name || !isChatPermissionOptionKind(kind)) {
      return [];
    }
    return [{ optionId, name, kind }];
  });
  return options.length === value.length ? options : [];
}

function readConfigOptions(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const option = readObject(item);
    return option ? [option] : [];
  });
}

function findModelConfigOption(value: unknown): JsonObject | null {
  return (
    readConfigOptions(value).find((option) => {
      const id = readString(option.id)?.toLowerCase();
      const category = readString(option.category)?.toLowerCase();
      return id === "model" || category === "model";
    }) ?? null
  );
}

function findModeConfigOption(value: unknown): JsonObject | null {
  return (
    readConfigOptions(value).find((option) => {
      const id = readString(option.id)?.toLowerCase();
      const category = readString(option.category)?.toLowerCase();
      return id === "mode" || category === "mode";
    }) ?? null
  );
}

function readConfigOptionValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const option = readObject(item);
    const optionValue = readString(option?.value);
    return optionValue ? [optionValue] : [];
  });
}

function getKimiModeValue(mode: RuntimeMode) {
  switch (mode) {
    case "approval-required":
      return "default";
    case "auto-accept-edits":
      return "yolo";
    case "full-access":
      return "auto";
  }
}

function readTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(readTextContent).filter(Boolean).join("");
  }

  const item = readObject(value);
  if (!item) {
    return "";
  }

  if (item.type === "text") {
    return readString(item.text) ?? "";
  }

  if (item.type === "content") {
    return readTextContent(item.content);
  }

  return readString(item.text) ?? readString(item.content) ?? "";
}

function normalizeToolStatus(value: string | null): "running" | "completed" | "failed" {
  if (value === "completed") {
    return "completed";
  }

  if (value === "failed") {
    return "failed";
  }

  return "running";
}

// Maps the raw ACP tool status string onto the timeline tool contract. ACP's
// `pending` (a tool that has not started executing yet) is preserved as the
// timeline `pending` state; `in_progress` and any unrecognized intermediate
// value stay `running`.
function kimiToolTimelineStatus(
  status: string | null,
): Extract<KimiTimelineItem, { type: "tool" }>["status"] {
  if (status === "completed") {
    return "completed";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "pending") {
    return "pending";
  }

  return "running";
}

// Captures the tool input snapshot shown in the timeline. Prefers the ACP
// rawInput object; falls back to the textual content for tools that pass their
// input inline. Long payloads are truncated to the same cap as tool output.
function readToolInput(rawInput: JsonObject | null, content: string): string {
  if (rawInput) {
    const input = truncateToolOutput(safeStringifyToolPayload(rawInput));
    return input;
  }

  return content ? truncateToolOutput(content) : "";
}

function safeStringifyToolPayload(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getToolOutput(update: JsonObject, content: string) {
  const status = normalizeToolStatus(readString(update.status));
  const rawOutput = readString(update.rawOutput);
  if (rawOutput) {
    return rawOutput;
  }

  if (status === "failed" || status === "completed") {
    return content;
  }

  return "";
}

const TRUNCATED_OUTPUT_MARKER = "\n\n[output truncated]";

function truncateToolOutput(output: string) {
  if (output.length <= MAX_TOOL_OUTPUT_LENGTH) {
    return output;
  }

  return `${output.slice(0, MAX_TOOL_OUTPUT_LENGTH)}${TRUNCATED_OUTPUT_MARKER}`;
}

// Subagent task text is persisted, where the normalizer rejects fields longer
// than MAX_SUBAGENT_TASK_TEXT_LENGTH, so the marker must fit inside the cap.
function truncateSubagentTaskText(text: string) {
  if (text.length <= MAX_SUBAGENT_TASK_TEXT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_SUBAGENT_TASK_TEXT_LENGTH - TRUNCATED_OUTPUT_MARKER.length)}${TRUNCATED_OUTPUT_MARKER}`;
}

function parseJsonObject(value: string): JsonObject | null {
  if (!value.trim().startsWith("{")) {
    return null;
  }

  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

const KIMI_AGENT_TITLE_PATTERN = /^Launching [A-Za-z][A-Za-z0-9_-]* agent: /u;
const KIMI_AGENT_SWARM_TITLE_PREFIX = "Launching agent swarm:";

type KimiSubagentStart =
  | {
      source: "agent";
      description: string;
      prompt?: string;
      agentType?: string;
      background: boolean;
    }
  | {
      source: "agent-swarm";
      description: string;
      agentType?: string;
      agentCount: number;
      background: boolean;
    };

function matchKimiSubagentStart(
  title: string,
  rawInput: JsonObject | null,
): KimiSubagentStart | null {
  if (!rawInput) {
    return null;
  }

  if (title.startsWith(KIMI_AGENT_SWARM_TITLE_PREFIX)) {
    const description = readString(rawInput.description);
    if (!description) {
      return null;
    }

    const items =
      Array.isArray(rawInput.items) && rawInput.items.every((item) => typeof item === "string")
        ? rawInput.items.length
        : 0;
    const resumeAgentIds = readObject(rawInput.resume_agent_ids);
    const resumes =
      resumeAgentIds && !Array.isArray(rawInput.resume_agent_ids)
        ? Object.keys(resumeAgentIds).length
        : 0;

    return {
      source: "agent-swarm",
      description,
      agentType: readString(rawInput.subagent_type) ?? undefined,
      agentCount: items + resumes,
      background: rawInput.run_in_background === true,
    };
  }

  if (!KIMI_AGENT_TITLE_PATTERN.test(title)) {
    return null;
  }

  const description = readString(rawInput.description);
  const prompt = readString(rawInput.prompt);
  const resume = readString(rawInput.resume);
  const agentType = readString(rawInput.subagent_type);
  if (!description || (!prompt && !resume && !agentType)) {
    return null;
  }

  return {
    source: "agent",
    description,
    prompt: prompt ?? undefined,
    agentType: agentType ?? undefined,
    background: rawInput.run_in_background === true,
  };
}

function extractSubagentResultText(update: JsonObject, content: string) {
  const rawOutput = readString(update.rawOutput);
  if (rawOutput) {
    return rawOutput;
  }

  const rawOutputObject = readObject(update.rawOutput);
  const rawOutputText = readString(rawOutputObject?.output);
  if (rawOutputText) {
    return rawOutputText;
  }

  const parsedContent = parseJsonObject(content);
  const parsedContentOutput = readString(parsedContent?.output);
  if (parsedContentOutput) {
    return parsedContentOutput;
  }

  const status = normalizeToolStatus(readString(update.status));
  if (status === "failed" || status === "completed") {
    return content;
  }

  return "";
}

function parseKimiAgentResult(text: string) {
  let runtimeAgentId: string | undefined;
  let agentType: string | undefined;
  let status: string | undefined;
  let summaryLines: string[] | null = null;
  let recognized = false;

  for (const line of text.split("\n")) {
    if (summaryLines) {
      summaryLines.push(line);
      continue;
    }

    if (line.trim() === "[summary]") {
      summaryLines = [];
      recognized = true;
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const header = /^(agent_id|actual_subagent_type|status): (.+)$/u.exec(line);
    if (!header) {
      return null;
    }

    recognized = true;
    const value = header[2].trim();
    if (header[1] === "agent_id") {
      runtimeAgentId = value;
    } else if (header[1] === "actual_subagent_type") {
      agentType = value;
    } else {
      status = value;
    }
  }

  if (!recognized) {
    return null;
  }

  const summary = summaryLines ? summaryLines.join("\n").trim() : "";
  return {
    runtimeAgentId,
    agentType,
    status,
    summary: summary || undefined,
  };
}

function commandFromTitle(title: string) {
  const match = /^Running:\s*(.+)$/u.exec(title);
  return match?.[1] ?? null;
}

function commandFromText(text: string) {
  const match = /Running:\s*([^\n]+)/u.exec(text);
  return match?.[1]?.trim() ?? null;
}

const KIMI_QUESTION_TOOL_TITLE = "AskUserQuestion";

function isKimiQuestionToolCall(payload: JsonObject | null): boolean {
  const toolCall = readObject(payload?.toolCall);
  return readString(toolCall?.title) === KIMI_QUESTION_TOOL_TITLE;
}

// Kimi's ACP adapter degrades AskUserQuestion to the first question as a
// single-select permission request. Only the data Kimi actually forwarded is
// surfaced; dropped questions, descriptions, and Other content are never
// reconstructed.
function buildChatQuestionRequest(options: {
  id: string;
  runId: string;
  request: ChatTurnRequest;
  source: ChatQuestionSource;
  questions: ChatQuestionItem[];
  skipOptionId?: string;
}): ChatQuestionRequest {
  return {
    id: options.id,
    runId: options.runId,
    requestKey: options.request.requestKey,
    threadId: options.request.threadId,
    provider: "kimi",
    source: options.source,
    questions: options.questions,
    ...(options.skipOptionId ? { skipOptionId: options.skipOptionId } : {}),
    createdAt: new Date().toISOString(),
  };
}

function buildKimiQuestionRequest(options: {
  id: JsonRpcId;
  runId: string;
  request: ChatTurnRequest;
  params: unknown;
  permissionOptions: ChatPermissionOption[];
}): ChatQuestionRequest | null {
  const payload = readObject(options.params);
  const toolCall = readObject(payload?.toolCall);
  const rawInput = readObject(toolCall?.rawInput);
  const firstQuestion = Array.isArray(rawInput?.questions)
    ? readObject(rawInput.questions[0])
    : null;
  const questionText = firstQuestion ? readString(firstQuestion.question) : null;
  if (!questionText) {
    return null;
  }

  const header = (firstQuestion ? readString(firstQuestion.header) : null) ?? "Question";
  const skipOption = options.permissionOptions.find((option) => option.kind === "reject_once");

  return buildChatQuestionRequest({
    id: `kimi-question-${options.runId}-${String(options.id)}`,
    runId: options.runId,
    request: options.request,
    source: "native-acp",
    questions: [
      {
        header,
        question: questionText,
        options: options.permissionOptions.map((option) => ({
          optionId: option.optionId,
          label: option.name,
        })),
        multiSelect: false,
      },
    ],
    ...(skipOption ? { skipOptionId: skipOption.optionId } : {}),
  });
}

function buildKimiPermissionRequest(options: {
  id: JsonRpcId;
  runId: string;
  request: ChatTurnRequest;
  params: unknown;
  permissionOptions: ChatPermissionOption[];
}): ChatPermissionRequest {
  const payload = readObject(options.params);
  const toolCall = readObject(payload?.toolCall);
  const rawInput = readObject(toolCall?.rawInput);
  const content = readTextContent(toolCall?.content);
  const title = readString(toolCall?.title) ?? "Kimi permission request";
  const kind = readString(toolCall?.kind) ?? "";
  const command =
    readString(rawInput?.command) ??
    commandFromTitle(title) ??
    commandFromText(content) ??
    undefined;
  const filePath =
    readString(rawInput?.path) ??
    readString(rawInput?.file_path) ??
    readString(rawInput?.filePath) ??
    undefined;
  const action = inferPermissionAction(title, kind, content, command, filePath);
  const createdAt = new Date().toISOString();
  const displayTitle =
    action === "shell" && command ? `Run command: ${command}` : `Kimi permission: ${title}`;
  const planReview = buildKimiPlanReview(title, toolCall?.content, options.permissionOptions);

  return {
    id: `kimi-permission-${options.runId}-${String(options.id)}`,
    runId: options.runId,
    requestKey: options.request.requestKey,
    threadId: options.request.threadId,
    provider: "kimi",
    action,
    title: planReview ? "Review plan" : displayTitle,
    description: planReview ? undefined : content || undefined,
    command,
    filePath,
    toolName: title,
    options: options.permissionOptions,
    ...(planReview ? { planReview } : {}),
    createdAt,
    expiresAt: buildPermissionExpiry(createdAt, CHAT_PERMISSION_TIMEOUT_MS),
  };
}

function buildKimiPlanReview(title: string, content: unknown, options: ChatPermissionOption[]) {
  if (title !== "ExitPlanMode" || !options.some((option) => option.optionId.startsWith("plan_"))) {
    return null;
  }

  const planContent = readTextBlocks(content).find(
    (text) => !text.startsWith("Requesting approval to"),
  );
  const plan = planContent?.replace(/^Plan saved to: [^\n]+\n\n/u, "").trim();
  if (!plan) {
    throw new Error("Kimi Plan Review did not include a plan.");
  }

  return { content: plan };
}

function readTextBlocks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const text = readTextContent(value);
    return text ? [text] : [];
  }

  return value.flatMap((item) => {
    const text = readTextContent(item);
    return text ? [text] : [];
  });
}

type KimiProviderLogCursor = {
  logPath: string;
  byteOffset: number;
};

async function captureKimiProviderLogCursor(
  sessionId: string,
  sessionsRoot: string,
): Promise<KimiProviderLogCursor | null> {
  const logPath = await findKimiProviderLogPath(sessionId, sessionsRoot);
  if (!logPath) {
    return null;
  }

  try {
    const contents = await readFile(logPath);
    return { logPath, byteOffset: contents.byteLength };
  } catch {
    return { logPath, byteOffset: 0 };
  }
}

async function readKimiProviderFailure(options: {
  cursor: KimiProviderLogCursor | null;
  sessionId: string;
  sessionsRoot: string;
  stderr: string;
  startedAt: number;
}): Promise<string | null> {
  const logPath =
    options.cursor?.logPath ??
    (await findKimiProviderLogPath(options.sessionId, options.sessionsRoot));
  if (logPath) {
    try {
      const contents = await readFile(logPath);
      const byteOffset = Math.min(options.cursor?.byteOffset ?? 0, contents.byteLength);
      const failure = parseKimiProviderLog(
        contents.subarray(byteOffset).toString("utf8"),
        options.startedAt,
      );
      if (failure) {
        return failure;
      }
      if (byteOffset > 0) {
        const fullLogFailure = parseKimiProviderLog(contents.toString("utf8"), options.startedAt);
        if (fullLogFailure) {
          return fullLogFailure;
        }
      }
    } catch {
      // The log is only a best-effort fallback for provider errors.
    }
  }

  const stderr = options.stderr.trim();
  return stderr ? `Kimi ACP error: ${stderr}` : null;
}

async function findKimiProviderLogPath(
  sessionId: string,
  sessionsRoot: string,
): Promise<string | null> {
  const indexPath = path.join(path.dirname(sessionsRoot), "session_index.jsonl");
  let indexText: string;
  try {
    indexText = await readFile(indexPath, "utf8");
  } catch {
    return null;
  }

  const resolvedSessionsRoot = path.resolve(sessionsRoot);
  for (const line of indexText.split(/\r?\n/u).reverse()) {
    if (!line.trim()) {
      continue;
    }

    let record: JsonObject | null;
    try {
      record = readObject(JSON.parse(line));
    } catch {
      continue;
    }

    if (readString(record?.sessionId) !== sessionId) {
      continue;
    }

    const sessionDir = readString(record?.sessionDir);
    if (!sessionDir) {
      return null;
    }

    const resolvedSessionDir = path.resolve(sessionDir);
    if (!isContainedRelativePath(path.relative(resolvedSessionsRoot, resolvedSessionDir))) {
      return null;
    }
    return path.join(resolvedSessionDir, "logs", "kimi-code.log");
  }

  return null;
}

function parseKimiProviderLog(logText: string, startedAt: number): string | null {
  for (const line of logText.split(/\r?\n/u).reverse()) {
    const timestamp = Date.parse(/^([^ ]+)\s/u.exec(line)?.[1] ?? "");
    if (Number.isFinite(timestamp) && timestamp < startedAt) {
      continue;
    }

    const match = /acp: turn ended with failed reason\s+error="((?:\\.|[^"\\])*)"/u.exec(line);
    if (match) {
      try {
        const errorText = JSON.parse(`"${match[1]}"`);
        const error = readObject(JSON.parse(errorText));
        const formatted = formatKimiAcpError(error, "Kimi Code provider error");
        if (formatted) {
          return formatted;
        }
      } catch {
        // Ignore malformed or partially-written log entries.
      }
    }

    const requestFailure =
      /llm request failed\b.*?errorMessage="((?:\\.|[^"\\])*)".*?statusCode=(\d+)/u.exec(line);
    if (requestFailure) {
      try {
        const message = JSON.parse(`"${requestFailure[1]}"`);
        const statusCode = readStatusCode(requestFailure[2]);
        const formatted = formatKimiAcpError(
          { message, ...(statusCode ? { details: { statusCode } } : {}) },
          "Kimi Code provider error",
        );
        if (formatted) {
          return formatted;
        }
      } catch {
        // Ignore malformed or partially-written log entries.
      }
    }
  }

  return null;
}

function formatKimiAcpError(error: JsonObject | null, label = "Kimi Code error"): string | null {
  if (!error) {
    return null;
  }

  const details = readObject(error.details);
  const data = readObject(error.data);
  const statusCode =
    readStatusCode(error.statusCode) ??
    readStatusCode(details?.statusCode) ??
    readStatusCode(data?.statusCode);
  const code = readString(error.code);
  const message = readString(error.message);
  if (!statusCode && !code && !message) {
    return null;
  }
  if (!statusCode && !code) {
    return message;
  }

  const reason = statusCode ? `HTTP ${statusCode}` : (code ?? "ACP");
  const displayMessage = message
    ? statusCode
      ? message.replace(new RegExp(`^${statusCode}\\s+`, "u"), "").trim()
      : message
    : "Unknown error";
  return `${label} (${reason}): ${displayMessage}`;
}

function readStatusCode(value: unknown): number | null {
  const statusCode =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null;
}

function getKimiSessionsRoot() {
  return path.join(os.homedir(), ".kimi-code", "sessions");
}

function isCurrentKimiPlanPath(targetPath: string, sessionId: string, sessionsRoot: string) {
  const relative = path.relative(sessionsRoot, targetPath);
  if (!isContainedRelativePath(relative)) {
    return false;
  }

  const segments = relative.split(path.sep);
  const sessionIndex = segments.indexOf(sessionId);
  const tail = sessionIndex >= 0 ? segments.slice(sessionIndex + 1) : [];
  return (
    sessionIndex > 0 &&
    tail.length === 4 &&
    tail[0] === "agents" &&
    tail[1].length > 0 &&
    tail[2] === "plans" &&
    tail[3].endsWith(".md") &&
    tail[3] !== ".md"
  );
}

async function resolveContainedTextFilePath(options: {
  targetPath: string;
  rootRealPath: string;
  access: "read" | "write";
  refusalMessage: string;
}) {
  if (options.access === "read") {
    const targetRealPath = await realpath(options.targetPath);
    if (!isContainedRelativePath(path.relative(options.rootRealPath, targetRealPath))) {
      throw new Error(options.refusalMessage);
    }
    return targetRealPath;
  }

  try {
    const targetRealPath = await realpath(options.targetPath);
    if (!isContainedRelativePath(path.relative(options.rootRealPath, targetRealPath))) {
      throw new Error(options.refusalMessage);
    }
    return targetRealPath;
  } catch (error) {
    if (readObject(error)?.code !== "ENOENT") {
      throw error;
    }
  }

  const existingAncestor = await findExistingAncestor(path.dirname(options.targetPath));
  const ancestorRealPath = await realpath(existingAncestor);
  if (!isContainedRelativePath(path.relative(options.rootRealPath, ancestorRealPath))) {
    throw new Error(options.refusalMessage);
  }
  return options.targetPath;
}

async function resolveCanonicalCandidatePath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch (error) {
    if (readObject(error)?.code !== "ENOENT") {
      throw error;
    }
  }

  const existingAncestor = await findExistingAncestor(path.dirname(targetPath));
  const ancestorRealPath = await realpath(existingAncestor);
  return path.resolve(ancestorRealPath, path.relative(existingAncestor, targetPath));
}

function isContainedRelativePath(relativePath: string) {
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

async function findExistingAncestor(targetPath: string): Promise<string> {
  let current = targetPath;
  while (true) {
    try {
      await realpath(current);
      return current;
    } catch (error) {
      const code = readObject(error)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`No existing parent for ${targetPath}`);
    }
    current = parent;
  }
}

function inferPermissionAction(
  title: string,
  kind: string,
  content: string,
  command: string | undefined,
  filePath: string | undefined,
): ChatPermissionAction {
  const haystack = `${title} ${kind} ${content}`.toLowerCase();

  if (command || haystack.includes("bash") || haystack.includes("running:")) {
    return "shell";
  }

  if (haystack.includes("network") || haystack.includes("fetch")) {
    return "network";
  }

  if (haystack.includes("read")) {
    return "read";
  }

  if (
    filePath ||
    ["edit", "write", "delete", "move"].some((keyword) => haystack.includes(keyword))
  ) {
    return haystack.includes("edit") ? "edit" : "write";
  }

  return "unknown";
}

function describeToolActivity(title: string, kind: string, filePath: string) {
  const normalizedKind = kind.toLowerCase();
  const target = filePath ? ` ${filePath}` : "";

  if (normalizedKind === "read") {
    return `Read${target}`;
  }

  if (normalizedKind === "search") {
    return `Search${target}`;
  }

  if (["edit", "write", "delete", "move"].includes(normalizedKind)) {
    return `${capitalize(normalizedKind)}${target}`;
  }

  return `${title}${target}`;
}

function capitalize(value: string) {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}
