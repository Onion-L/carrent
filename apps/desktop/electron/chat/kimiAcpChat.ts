import type { ChildProcess } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ChatRunEvent,
  ChatTurnRequest,
  Attachment,
  KimiSessionStatus,
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
import type { RuntimeMode } from "../../src/shared/runtimeMode";
import type { CarrentBridgeFactory, CarrentBridgeHandle } from "../bridge/carrentBridge";
import { buildChatPrompt, DEFAULT_FILE_ONLY_PROMPT, DEFAULT_IMAGE_ONLY_PROMPT } from "./chatPrompt";

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

const MAX_TOOL_OUTPUT_LENGTH = 12_000;
const MAX_TEXT_FILE_WRITE_BYTES = 4 * 1024 * 1024;
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
  bridgeFactory?: CarrentBridgeFactory | null;
  kimiSessionsRoot?: string;
  attachmentStoreRoot?: string;
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
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  private nextId = 1;
  private sessionId: string | null = null;
  private finalText = "";
  private reasoningText = "";
  private reasoningSegmentIndex = 0;
  private terminal = false;
  private stoppedByUser = false;
  private stopFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private bridge: CarrentBridgeHandle | null = null;
  private lastPlanMode: boolean | null = null;
  private presentedPlanReview = false;
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
      bridgeFactory?: CarrentBridgeFactory | null;
      kimiSessionsRoot?: string;
      attachmentStoreRoot?: string;
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
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
      });

      await this.startBridge();
      if (this.terminal) {
        return;
      }
      await this.prepareAttachmentTargets();
      const { configOptions, resumed } = await this.openSession();

      await this.configureModel(configOptions);
      await this.configureRuntimeMode(configOptions);

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
      const stopReason = readString(promptResult?.stopReason);
      if (stopReason === "cancelled" || this.stoppedByUser) {
        this.completeStopped();
        return;
      }

      if (!this.finalText.trim() && !this.presentedPlanReview) {
        this.fail("Received empty response from Kimi Code.");
        return;
      }

      this.completeReasoningSegment();

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
      } catch {
        this.sessionId = null;
        await this.forgetInvalidSession(resumeSessionId);
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
    return this.bridge ? [this.bridge.mcpServer] : [];
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
      this.fail("Kimi requested permission without any supported response options.");
      return;
    }

    const permission = buildKimiPermissionRequest({
      id,
      runId: this.options.runId,
      request: this.options.request,
      params,
      permissionOptions: options,
    });
    const conversationOption = permission.planReview
      ? findPlanConversationOption(permission.options)
      : null;
    if (permission.planReview && !conversationOption) {
      await this.respond(id, { outcome: { outcome: "cancelled" } });
      this.fail("Kimi Plan Review did not include an option to return to the conversation.");
      return;
    }

    this.pendingPermissions.set(permission.id, {
      acpRequestId: id,
      options,
    });
    this.emit({
      type: "permission-requested",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      permission,
    });

    if (conversationOption) {
      this.presentedPlanReview = true;
      this.respondToPermission({
        runId: this.options.runId,
        permissionId: permission.id,
        optionId: conversationOption.optionId,
      });
    }
  }

  private async handleReadTextFile(params: unknown) {
    const payload = readObject(params);
    const requestedPath = readString(payload?.path);
    if (!requestedPath) {
      throw new Error("Kimi ACP requested a file without a path.");
    }

    const target = await this.resolveTextFileTarget(requestedPath, "read");

    if (target.kind === "workspace") {
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

    const workspacePath = path.resolve(this.options.cwd);
    const workspaceRealPath = await realpath(this.options.cwd);
    const workspaceRelative = path.relative(workspacePath, resolvedPath);
    const isLexicallyInWorkspace = isContainedRelativePath(workspaceRelative);

    if (isLexicallyInWorkspace) {
      const targetPath = await resolveContainedTextFilePath({
        targetPath: resolvedPath,
        rootRealPath: workspaceRealPath,
        access,
        refusalMessage: `Refusing to ${access} outside workspace: ${requestedPath}`,
      });
      return {
        kind: "workspace" as const,
        path: targetPath,
        relativePath: workspaceRelative,
      };
    }

    const sessionsRoot = this.options.kimiSessionsRoot ?? getKimiSessionsRoot();
    if (!this.sessionId || !isCurrentKimiPlanPath(resolvedPath, this.sessionId, sessionsRoot)) {
      throw new Error(`Refusing to ${access} outside workspace: ${requestedPath}`);
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

    if (updateType === "config_option_update") {
      const modeConfig = findModeConfigOption(update?.configOptions);
      const currentMode = readString(modeConfig?.currentValue);
      if (currentMode) {
        this.emitPlanModeChanged(currentMode === "plan");
      }
      return;
    }

    if (updateType === "agent_message_chunk" && text) {
      if (this.presentedPlanReview) {
        return;
      }
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
      if (!this.reasoningText) {
        this.reasoningSegmentIndex += 1;
      }
      this.reasoningText += text;
      this.emit({
        type: "reasoning",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        reasoning: {
          id: `kimi-thinking-${this.reasoningSegmentIndex}`,
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
    if (!existing) {
      this.completeReasoningSegment();
    }
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
    const status = normalizeToolStatus(readString(update.status));
    const output = getToolOutput(update, content);

    if (status !== "running") {
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

    if (isShellTool(title, kind)) {
      this.emit({
        type: "shell",
        runId: this.options.runId,
        requestKey: this.options.request.requestKey,
        shell: {
          id,
          command,
          output: truncateToolOutput(output),
          status,
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
        status: status === "running" ? "running" : "completed",
      },
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

  private completeReasoningSegment() {
    if (!this.reasoningText) {
      return;
    }

    this.emit({
      type: "reasoning",
      runId: this.options.runId,
      requestKey: this.options.request.requestKey,
      reasoning: {
        id: `kimi-thinking-${this.reasoningSegmentIndex}`,
        content: this.reasoningText,
        status: "completed",
      },
    });
    this.reasoningText = "";
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
          planMode: this.options.request.planMode,
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
    this.closeBridge();
    this.options.emit(event);
    this.transport.close();
    this.options.onDone?.();
  }

  private closeBridge() {
    const bridge = this.bridge;
    this.bridge = null;
    if (!bridge) {
      return;
    }

    void bridge.close().catch(() => {
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

function findPlanConversationOption(options: ChatPermissionOption[]) {
  return (
    options.find((option) => option.optionId === "plan_reject_and_exit") ??
    options.find(
      (option) =>
        option.kind === "reject_once" && option.name.trim().toLowerCase() === "reject and exit",
    ) ??
    null
  );
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
