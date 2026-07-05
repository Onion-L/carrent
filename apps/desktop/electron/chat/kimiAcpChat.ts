import type { ChildProcess } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ChatRunEvent,
  ChatTurnRequest,
  ImageAttachment,
  KimiSessionStatus,
} from "../../src/shared/chat";
import {
  CHAT_PERMISSION_TIMEOUT_MS,
  buildPermissionExpiry,
  type ChatPermissionAction,
  type ChatPermissionRequest,
  type ChatPermissionResponse,
} from "../../src/shared/chatPermissions";
import type { RuntimeMode } from "../../src/shared/runtimeMode";
import { DEFAULT_IMAGE_ONLY_PROMPT } from "./chatPrompt";

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

const MAX_TOOL_OUTPUT_LENGTH = 12_000;
const STOP_FALLBACK_MS = 5_000;

export type KimiAcpTransport = {
  send: (message: JsonObject) => void;
  close: () => void;
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
  respondToPermission: (response: ChatPermissionResponse) => void;
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
    close() {
      child.stdin?.end();
      child.kill("SIGTERM");
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
  onInvalidSession?: (sessionId: string) => void | Promise<void>;
  onCompletedSession?: (sessionId: string) => void | Promise<void>;
  onDone?: () => void;
  requestTimeoutMs?: number;
}): KimiAcpRunHandle {
  const runner = new KimiAcpRun(options);
  void runner.start();
  return {
    stop: () => runner.stop(),
    respondToPermission: (response) => runner.respondToPermission(response),
  };
}

export async function getKimiSessionStatus(options: {
  sessionId: string;
  cwd: string;
  transportFactory: KimiAcpTransportFactory;
  requestTimeoutMs?: number;
}): Promise<KimiSessionStatus | null> {
  const { sessionId, cwd, transportFactory, requestTimeoutMs = 30_000 } = options;
  const transport = transportFactory({ cwd });

  let statusText = "";
  let nextId = 1;
  const pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  return new Promise((resolve, reject) => {
    const timeoutTimer = setTimeout(() => {
      transport.close();
      reject(new Error("Timed out waiting for Kimi session status."));
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
          handler.reject(
            new Error(readString(errorObject?.message) ?? JSON.stringify(message.error)),
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
        const text = readTextContent(update?.content);
        if (updateType === "agent_message_chunk" && text) {
          statusText += text;
        }
      }
    });

    transport.onError((error) => {
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
      resolve(parseKimiStatusText(statusText));
    });

    const send = (method: string, params: JsonObject): Promise<unknown> => {
      const id = nextId++;
      const message = { jsonrpc: "2.0", id, method, params };
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        transport.send(message);
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
        await send("session/resume", { sessionId, cwd, mcpServers: [] });
        await send("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: "/status" }],
        });
        cleanup();
        resolve(parseKimiStatusText(statusText));
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

function parseKimiStatusText(text: string): KimiSessionStatus | null {
  const match = /Context:\s*([\d,]+)\s*\/\s*([\d,]+)\s*\(([\d.]+)%\)/u.exec(text);
  if (!match) {
    return null;
  }

  const used = Number.parseInt(match[1].replace(/,/gu, ""), 10);
  const total = Number.parseInt(match[2].replace(/,/gu, ""), 10);
  const percentage = Number.parseFloat(match[3]);
  const modelMatch = /Model:\s*(.+)/u.exec(text);

  return {
    model: modelMatch ? modelMatch[1].trim() : undefined,
    used,
    total,
    percentage,
  };
}

export async function buildKimiPromptParts(
  request: ChatTurnRequest,
): Promise<Array<Record<string, unknown>>> {
  const imageAttachments = request.attachments?.filter(
    (attachment): attachment is ImageAttachment & { localPath: string } =>
      typeof attachment.localPath === "string",
  );
  const messageText =
    request.message.trim() ||
    (imageAttachments && imageAttachments.length > 0 ? DEFAULT_IMAGE_ONLY_PROMPT : "");
  const parts: Array<Record<string, unknown>> = [];

  if (messageText) {
    parts.push({ type: "text", text: messageText });
  }

  for (const attachment of imageAttachments ?? []) {
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
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  private nextId = 1;
  private sessionId: string | null = null;
  private finalText = "";
  private reasoningText = "";
  private terminal = false;
  private stoppedByUser = false;
  private stopFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPermissions = new Map<
    string,
    {
      acpRequestId: JsonRpcId;
      approveOptionId: string;
      rejectOptionId: string;
    }
  >();
  private toolStates = new Map<
    string,
    {
      title: string;
      kind: string;
      command: string;
      filePath: string;
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
      onInvalidSession?: (sessionId: string) => void | Promise<void>;
      onCompletedSession?: (sessionId: string) => void | Promise<void>;
      onDone?: () => void;
      requestTimeoutMs?: number;
    },
  ) {
    this.transport = options.transportFactory({ cwd: options.cwd });
    this.transport.onMessage((message) => {
      void this.handleMessage(message);
    });
    this.transport.onError((error) => {
      if (this.stoppedByUser) {
        this.completeStopped();
        return;
      }

      this.fail(error.message);
    });
    this.transport.onClose(({ code, signal, stderr }) => {
      if (this.terminal) {
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
          fs: { readTextFile: true, writeTextFile: false },
          terminal: false,
        },
      });

      const configOptions = await this.openSession();

      await this.configureModel(configOptions);
      await this.configureRuntimeMode(configOptions);

      const promptPromise = this.request(
        "session/prompt",
        {
          sessionId: this.sessionId,
          prompt: await buildKimiPromptParts(this.options.request),
        },
        { timeoutMs: null },
      );

      this.emitThreadLifecycle();

      const promptResult = readObject(await promptPromise);
      const stopReason = readString(promptResult?.stopReason);
      if (stopReason === "cancelled" || this.stoppedByUser) {
        this.completeStopped();
        return;
      }

      if (!this.finalText.trim()) {
        this.fail("Received empty response from Kimi Code.");
        return;
      }

      if (this.reasoningText) {
        this.emit({
          type: "reasoning",
          runId: this.options.runId,
          requestKey: this.options.request.requestKey,
          reasoning: {
            id: "kimi-thinking",
            content: this.reasoningText,
            status: "completed",
          },
        });
      }

      await this.persistCompletedSession();

      this.complete({
        type: "completed",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        text: this.finalText.trim(),
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private async openSession() {
    const resumeSessionId = this.options.resumeSessionId ?? null;
    if (resumeSessionId) {
      try {
        this.sessionId = resumeSessionId;
        const resume = readObject(
          await this.request("session/resume", {
            sessionId: resumeSessionId,
            cwd: this.options.cwd,
            mcpServers: [],
          }),
        );
        return resume?.configOptions;
      } catch {
        this.sessionId = null;
        await this.forgetInvalidSession(resumeSessionId);
      }
    }

    const session = readObject(
      await this.request("session/new", {
        cwd: this.options.cwd,
        mcpServers: [],
      }),
    );
    this.sessionId = readString(session?.sessionId);
    if (!this.sessionId) {
      throw new Error("Kimi ACP did not return a session id.");
    }
    return session?.configOptions;
  }

  private async forgetInvalidSession(sessionId: string) {
    try {
      await this.options.onInvalidSession?.(sessionId);
    } catch {
      // Best-effort cleanup; the fallback session can still repair persisted state.
    }
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
    const selectedMode = getKimiModeValue(this.options.request.runtimeMode);
    const modeConfig = findModeConfigOption(configOptions);

    if (!modeConfig) {
      if (selectedMode === "default") {
        return;
      }

      throw new Error(
        `Kimi Code did not expose a mode configuration option. Use Approval required or update Kimi Code.`,
      );
    }

    if (readString(modeConfig.currentValue) === selectedMode) {
      return;
    }

    const supportedValues = readConfigOptionValues(modeConfig.options);
    if (!supportedValues.includes(selectedMode)) {
      throw new Error(
        `Kimi Code does not list mode "${selectedMode}". Use a supported runtime permission mode.`,
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

    const optionId =
      response.decision === "approved"
        ? pendingPermission.approveOptionId
        : pendingPermission.rejectOptionId;

    try {
      this.respond(pendingPermission.acpRequestId, {
        outcome: {
          outcome: "selected",
          optionId,
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
      decision: response.decision,
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
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: JsonObject) {
    this.transport.send({ jsonrpc: "2.0", method, params });
  }

  private async handleMessage(message: JsonObject) {
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

      const error = readObject(message.error);
      if (error) {
        pending.reject(new Error(readString(error.message) ?? JSON.stringify(error)));
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
    const approveOptionId = findPermissionOption(options, {
      kinds: ["allow_once"],
      names: [],
    });
    const rejectOptionId = findPermissionOption(options, {
      kinds: ["reject_once"],
      names: [],
    });

    if (!approveOptionId || !rejectOptionId) {
      await this.respond(id, { outcome: { outcome: "cancelled" } });
      this.fail(
        "Kimi requested permission, but Carrent could not map the ACP options to one-time approve/deny.",
      );
      return;
    }

    const permission = buildKimiPermissionRequest({
      id,
      runId: this.options.runId,
      request: this.options.request,
      params,
    });

    this.pendingPermissions.set(permission.id, {
      acpRequestId: id,
      approveOptionId,
      rejectOptionId,
    });
    this.emit({
      type: "permission-requested",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      permission,
    });
  }

  private async handleReadTextFile(params: unknown) {
    const payload = readObject(params);
    const requestedPath = readString(payload?.path);
    if (!requestedPath) {
      throw new Error("Kimi ACP requested a file without a path.");
    }

    const resolved = path.resolve(this.options.cwd, requestedPath);
    const workspaceRealPath = await realpath(this.options.cwd);
    const targetRealPath = await realpath(resolved);
    const relative = path.relative(workspaceRealPath, targetRealPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to read outside workspace: ${requestedPath}`);
    }

    this.emit({
      type: "reasoning",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      reasoning: {
        id: `kimi-fs-read-${targetRealPath}`,
        content: `Read ${relative || path.basename(targetRealPath)}`,
        status: "completed",
      },
    });

    return { content: await readFile(targetRealPath, "utf8") };
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

    if (updateType === "agent_message_chunk" && text) {
      this.finalText += text;
      this.emit({
        type: "delta",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        text,
      });
      return;
    }

    if (updateType === "agent_thought_chunk" && text) {
      this.reasoningText += text;
      this.emit({
        type: "reasoning",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        reasoning: {
          id: "kimi-thinking",
          content: this.reasoningText,
          status: "running",
        },
      });
      return;
    }

    if ((updateType === "tool_call" || updateType === "tool_call_update") && update) {
      this.handleToolUpdate(update);
    }
  }

  private handleToolUpdate(update: JsonObject) {
    const id = readString(update.toolCallId) ?? "kimi-tool";
    const existing = this.toolStates.get(id);
    const rawInput = readObject(update.rawInput);
    const content = readTextContent(update.content);
    const parsedContent = parseJsonObject(content);
    const title = readString(update.title) ?? existing?.title ?? "Kimi tool";
    const kind = readString(update.kind) ?? existing?.kind ?? "";
    const command =
      readString(rawInput?.command) ??
      readString(parsedContent?.command) ??
      existing?.command ??
      commandFromTitle(title) ??
      title;
    const filePath =
      readString(rawInput?.path) ??
      readString(rawInput?.file_path) ??
      readString(parsedContent?.path) ??
      readString(parsedContent?.file_path) ??
      existing?.filePath ??
      "";

    this.toolStates.set(id, { title, kind, command, filePath });

    if (isShellTool(title, kind)) {
      this.emit({
        type: "shell",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        shell: {
          id,
          command,
          output: truncateToolOutput(getToolOutput(update, content)),
          status: normalizeToolStatus(readString(update.status)),
        },
      });
      return;
    }

    this.emit({
      type: "reasoning",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      reasoning: {
        id: `kimi-tool-${id}`,
        content: describeToolActivity(title, kind, filePath),
        status:
          normalizeToolStatus(readString(update.status)) === "running" ? "running" : "completed",
      },
    });
  }

  private emitThreadLifecycle() {
    if (this.options.request.draftRef) {
      this.emit({
        type: "thread-upserted",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        draftId: this.options.request.draftRef.draftId,
        projectId: this.options.request.draftRef.projectId,
        thread: {
          id: this.options.request.threadId,
          title: this.options.request.draftRef.title,
          updatedAt: new Date().toISOString(),
          runtimeId: this.options.request.runtimeId,
          runtimeModelId: this.options.request.runtimeModelId,
          runtimeMode: this.options.request.runtimeMode,
        },
      });
    }

    this.emit({
      type: "started",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      threadId: this.options.request.threadId,
    });
  }

  private emit(event: ChatRunEvent) {
    if (!this.terminal) {
      this.options.emit(event);
    }
  }

  private fail(error: string) {
    this.complete({
      type: "failed",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      error,
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

  private completeStopped() {
    this.complete({
      type: "stopped",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
    });
  }

  private complete(event: ChatRunEvent) {
    if (this.terminal) {
      return;
    }

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
    this.options.emit(event);
    this.transport.close();
    this.options.onDone?.();
  }
}

function readObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPermissionOptions(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const option = readObject(item);
    return option ? [option] : [];
  });
}

function findPermissionOption(
  options: JsonObject[],
  filters: { kinds: string[]; names: string[] },
) {
  const byKind = options.find((option) => {
    const kind = readString(option.kind)?.toLowerCase();
    return kind ? filters.kinds.includes(kind) : false;
  });
  const byName =
    byKind ??
    options.find((option) => {
      const name = readString(option.name)?.toLowerCase();
      return name ? filters.names.some((needle) => name.includes(needle)) : false;
    });

  return readString(byName?.optionId);
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
      return "auto";
    case "full-access":
      return "yolo";
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

function isShellTool(title: string, kind: string) {
  return kind.toLowerCase() === "execute" || title.toLowerCase().includes("bash");
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

function truncateToolOutput(output: string) {
  if (output.length <= MAX_TOOL_OUTPUT_LENGTH) {
    return output;
  }

  return `${output.slice(0, MAX_TOOL_OUTPUT_LENGTH)}\n\n[output truncated]`;
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

function commandFromTitle(title: string) {
  const match = /^Running:\s*(.+)$/u.exec(title);
  return match?.[1] ?? null;
}

function commandFromText(text: string) {
  const match = /Running:\s*([^\n]+)/u.exec(text);
  return match?.[1]?.trim() ?? null;
}

function buildKimiPermissionRequest(options: {
  id: JsonRpcId;
  runId: string;
  request: ChatTurnRequest;
  params: unknown;
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

  return {
    id: `kimi-permission-${options.runId}-${String(options.id)}`,
    runId: options.runId,
    requestKey: options.request.requestKey,
    threadId: options.request.threadId,
    provider: "kimi",
    action,
    title: displayTitle,
    description: content || undefined,
    command,
    filePath,
    toolName: title,
    createdAt,
    expiresAt: buildPermissionExpiry(createdAt, CHAT_PERMISSION_TIMEOUT_MS),
  };
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
