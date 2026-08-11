import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AppStateCommand,
  AppStateCommandRejectionReason,
  AppStateCommandResult,
} from "../../src/shared/appStateAuthority";
import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";
import type { KimiAcpTransport, KimiAcpTransportFactory } from "./kimiAcpChat";

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

const TITLE_TIMEOUT_MS = 30_000;
const MAX_TITLE_SOURCE_GRAPHEMES = 8_000;
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export type ThreadTitleJobInput = {
  threadId: string;
  runId: string;
  source: string;
};

export type ThreadTitleDiagnostic = {
  threadId: string;
  modelId?: string;
  stage: "working-directory" | "acp" | "validation" | "write" | "complete";
  category:
    | AppStateCommandRejectionReason
    | "success"
    | "invalid-output"
    | "timeout"
    | "cancelled"
    | "failed";
  elapsedMs: number;
};

type ThreadTitleCoordinatorOptions = {
  getSnapshot: () => AppStateSnapshot;
  submitCommand: (command: AppStateCommand) => Promise<AppStateCommandResult>;
  transportFactory: KimiAcpTransportFactory;
  createWorkingDirectory?: () => Promise<string>;
  removeWorkingDirectory?: (cwd: string) => Promise<void>;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  log?: (diagnostic: ThreadTitleDiagnostic) => void;
};

type AcceptedThreadTitleJob = ThreadTitleJobInput & {
  expectedTitle: string;
  // The user's configured title-model preference, snapshotted from settings at
  // enqueue time so later Settings changes never alter an accepted job.
  //
  // - A concrete id (string) is validated against the ACP catalog at run time;
  //   if it is no longer listed the job is abandoned without switching models.
  // - Undefined means "Kimi default". The concrete default is resolvable only
  //   from the ACP session's configOptions, so it is resolved at session/new
  //   time (the earliest point the title process can report it) rather than at
  //   enqueue. The preference itself is still snapshotted: a later switch to a
  //   concrete id does not retroactively apply to a job accepted as "default".
  modelId: string | undefined;
};

function readObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function graphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value)].map((entry) => entry.segment);
}

function boundTitleSource(source: string): string {
  const segments = graphemes(source);
  return segments.length <= MAX_TITLE_SOURCE_GRAPHEMES
    ? source
    : segments.slice(0, MAX_TITLE_SOURCE_GRAPHEMES).join("");
}

function titlePrompt(source: string): string {
  return [
    "Create a concise title in the language of the supplied Thread title source.",
    'Return only one JSON object with exactly one string property named "title".',
    "Do not use Markdown or add any other fields.",
    "The source may have been truncated.",
    `Thread title source: ${JSON.stringify(source)}`,
  ].join("\n");
}

function unwrapJsonFence(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const match = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? null;
}

function stripPairedQuotes(value: string): string {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["「", "」"],
    ["『", "』"],
  ];
  const pair = pairs.find(([open, close]) => value.startsWith(open) && value.endsWith(close));
  return pair ? value.slice(pair[0].length, -pair[1].length).trim() : value;
}

function parseGeneratedTitle(output: string): string | null {
  const document = unwrapJsonFence(output);
  if (!document) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    return null;
  }
  const record = readObject(parsed);
  if (!record || Object.keys(record).length !== 1 || typeof record.title !== "string") return null;
  if (/[\r\n\v\f\u0085\u2028\u2029]/u.test(record.title)) return null;

  let title = stripPairedQuotes(record.title.trim());
  title = title.replace(/[\p{Terminal_Punctuation}]+$/u, "").trim();
  title = stripPairedQuotes(title);
  title = title.replace(/[\p{Terminal_Punctuation}]+$/u, "").trim();
  if (!title) return null;

  if (/\p{Script=Han}/u.test(title)) {
    const segments = graphemes(title);
    if (segments.length < 6) return null;
    return segments.slice(0, 18).join("");
  }

  const words = title.split(/\s+/u);
  if (words.length < 3) return null;
  return words.slice(0, 8).join(" ");
}

function findModelConfig(value: unknown): JsonObject | null {
  return (
    readObject(
      readArray(value).find((option) => {
        const record = readObject(option);
        return (
          readString(record?.id)?.toLowerCase() === "model" ||
          readString(record?.category)?.toLowerCase() === "model"
        );
      }),
    ) ?? null
  );
}

class TitleAcpClient {
  private nextId = 1;
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private output = "";
  private closed = false;

  constructor(private readonly transport: KimiAcpTransport) {
    transport.onMessage((message) => this.handleMessage(message));
    transport.onError((error) => this.failPending(error));
    transport.onClose(() =>
      this.failPending(new Error("Kimi ACP closed before title completion.")),
    );
  }

  async generate(
    cwd: string,
    source: string,
    configuredModelId: string | undefined,
  ): Promise<{ modelId: string; output: string }> {
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    const session = readObject(
      await this.request("session/new", {
        cwd,
        mcpServers: [],
      }),
    );
    const sessionId = readString(session?.sessionId);
    if (!sessionId) throw new Error("Kimi ACP did not return a title session id.");

    const modelConfig = findModelConfig(session?.configOptions);
    const supportedModels = readArray(modelConfig?.options).flatMap((option) => {
      const value = readString(readObject(option)?.value);
      return value ? [value] : [];
    });

    // Resolve the concrete model id to configure before prompting. A configured
    // (snapshotted) selection wins and must be in the catalog — otherwise the
    // job is abandoned without switching models or retrying. "Kimi default"
    // (undefined) resolves to the ACP default; if that is missing the job fails
    // the same way and the fallback title stays.
    if (!modelConfig) {
      throw new Error("Kimi ACP model config is unavailable.");
    }
    let modelId: string;
    if (configuredModelId) {
      if (!supportedModels.includes(configuredModelId)) {
        throw new Error("Configured Thread title model is unavailable.");
      }
      modelId = configuredModelId;
    } else {
      const defaultId = readString(modelConfig.currentValue);
      if (!defaultId || !supportedModels.includes(defaultId)) {
        throw new Error("Kimi ACP default title model is unavailable.");
      }
      modelId = defaultId;
    }

    await this.request("session/set_config_option", {
      sessionId,
      configId: readString(modelConfig.id) ?? "model",
      value: modelId,
    });
    await this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: titlePrompt(source) }],
    });
    return { modelId, output: this.output };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.failPending(new Error("Thread title request closed."));
    await this.transport.close();
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private handleMessage(message: JsonObject) {
    if (this.closed) return;

    if (message.method && message.id != null) {
      this.transport.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Title requests do not allow tools or approvals." },
      });
      return;
    }

    if (message.id != null && this.pending.has(message.id as JsonRpcId)) {
      const handler = this.pending.get(message.id as JsonRpcId)!;
      this.pending.delete(message.id as JsonRpcId);
      const error = readObject(message.error);
      if (error) {
        handler.reject(new Error(readString(error.message) ?? "Kimi ACP request failed."));
      } else {
        handler.resolve(message.result);
      }
      return;
    }

    if (message.method !== "session/update") return;
    const update = readObject(readObject(message.params)?.update);
    if (readString(update?.sessionUpdate) !== "agent_message_chunk") return;
    const content = readObject(update?.content);
    if (readString(content?.type) !== "text") return;
    const text = readString(content?.text);
    if (text) this.output += text;
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function eligibleJob(
  snapshot: AppStateSnapshot,
  input: ThreadTitleJobInput,
): AcceptedThreadTitleJob | null {
  if (!input.source.trim()) return null;
  const thread = (snapshot.threads ?? []).find((candidate) => candidate.id === input.threadId);
  if (!thread || thread.archived || thread.customTitle) return null;
  const threadRuns = (snapshot.threadRuns ?? []).filter((run) => run.threadId === input.threadId);
  if (threadRuns.length !== 1 || threadRuns[0]?.id !== input.runId) return null;
  return {
    ...input,
    source: boundTitleSource(input.source),
    expectedTitle: thread.title,
    // Snapshot the configured model once: later Settings or Kimi default
    // changes must not alter an already-accepted job.
    modelId: snapshot.settings?.threadTitleModelId,
  };
}

export function createThreadTitleCoordinator(options: ThreadTitleCoordinatorOptions) {
  const createWorkingDirectory =
    options.createWorkingDirectory ??
    (() => mkdtemp(path.join(os.tmpdir(), "carrent-thread-title-")));
  const removeWorkingDirectory =
    options.removeWorkingDirectory ?? ((cwd: string) => rm(cwd, { recursive: true, force: true }));
  const now = options.now ?? Date.now;
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout;
  const activeTasks = new Set<Promise<void>>();
  const activeControllers = new Set<AbortController>();
  const activeJobKeys = new Set<string>();
  let shuttingDown = false;

  function log(job: AcceptedThreadTitleJob, input: Omit<ThreadTitleDiagnostic, "threadId">) {
    options.log?.({
      threadId: job.threadId.slice(0, 128),
      ...input,
      ...(input.modelId ? { modelId: input.modelId.slice(0, 256) } : {}),
    });
  }

  async function run(job: AcceptedThreadTitleJob, signal: AbortSignal) {
    let cwd: string | null = null;
    let client: TitleAcpClient | null = null;
    let modelId: string | undefined;
    let startedAt = 0;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let handleAbort: (() => void) | null = null;
    try {
      cwd = await createWorkingDirectory();
      startedAt = now();
      const timedOut = new Promise<never>((_resolve, reject) => {
        timeout = scheduleTimeout(
          () => reject(new Error("Thread title request timed out.")),
          TITLE_TIMEOUT_MS,
        );
      });
      const cancelled = new Promise<never>((_resolve, reject) => {
        handleAbort = () => reject(new Error("Thread title request cancelled."));
        signal.addEventListener("abort", handleAbort, { once: true });
        if (signal.aborted) handleAbort();
      });
      const transport = options.transportFactory({ cwd });
      client = new TitleAcpClient(transport);
      const generated = await Promise.race([
        client.generate(cwd, job.source, job.modelId),
        timedOut,
        cancelled,
      ]);
      modelId = generated.modelId;
      const title = parseGeneratedTitle(generated.output);
      if (!title) {
        log(job, {
          modelId,
          stage: "validation",
          category: "invalid-output",
          elapsedMs: now() - startedAt,
        });
        return;
      }
      const writeResult = await options.submitCommand({
        commandId: `thread-title:${job.threadId}:${job.runId}`,
        type: "thread:set-automatic-title",
        payload: {
          threadId: job.threadId,
          expectedTitle: job.expectedTitle,
          title,
        },
      });
      if (writeResult.status !== "accepted") {
        log(job, {
          modelId,
          stage: "write",
          category: writeResult.reason,
          elapsedMs: now() - startedAt,
        });
        return;
      }
      log(job, {
        modelId,
        stage: "complete",
        category: "success",
        elapsedMs: now() - startedAt,
      });
    } catch (error) {
      log(job, {
        ...(modelId ? { modelId } : {}),
        stage: startedAt === 0 ? "working-directory" : "acp",
        category:
          error instanceof Error && error.message.includes("timed out")
            ? "timeout"
            : error instanceof Error && error.message.includes("cancelled")
              ? "cancelled"
              : "failed",
        elapsedMs: startedAt === 0 ? 0 : now() - startedAt,
      });
    } finally {
      if (timeout) cancelTimeout(timeout);
      if (handleAbort) signal.removeEventListener("abort", handleAbort);
      await client?.close().catch(() => {});
      if (cwd) await removeWorkingDirectory(cwd).catch(() => {});
    }
  }

  function enqueue(input: ThreadTitleJobInput) {
    if (shuttingDown) return false;
    const job = eligibleJob(options.getSnapshot(), input);
    if (!job) return false;
    const key = `${job.threadId}:${job.runId}`;
    if (activeJobKeys.has(key)) return false;
    activeJobKeys.add(key);
    const controller = new AbortController();
    const task = run(job, controller.signal).finally(() => {
      activeJobKeys.delete(key);
      activeTasks.delete(task);
      activeControllers.delete(controller);
    });
    activeControllers.add(controller);
    activeTasks.add(task);
    return true;
  }

  return {
    enqueue,
    waitForIdle: () => Promise.allSettled(activeTasks).then(() => undefined),
    async shutdown() {
      shuttingDown = true;
      activeControllers.forEach((controller) => controller.abort());
      await Promise.allSettled(activeTasks);
    },
  };
}

export type ThreadTitleCoordinator = ReturnType<typeof createThreadTitleCoordinator>;
