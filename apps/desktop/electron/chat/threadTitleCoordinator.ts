import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AppStateCommand,
  AppStateCommandRejectionReason,
  AppStateCommandResult,
} from "../../src/shared/appStateAuthority";
import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";
import { boundGraphemes, boundThreadTitleSource } from "../../src/shared/threadTitle";
import type { KimiAcpTransport, KimiAcpTransportFactory } from "./kimiAcpChat";

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

const TITLE_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_TITLE_JOBS = 2;
const MAX_WAITING_TITLE_JOBS = 8;
// Ceiling on collected ACP agent-message text. A valid payload is one small
// JSON object, so a verbose or malformed response is rejected rather than
// accumulated for the whole 30-second window.
const MAX_TITLE_OUTPUT_CHARS = 8_192;
// Ceiling on remembered draft promotions awaiting their first Run. Promotion is
// immediately followed by the `chat:send` that consumes the entry, so this only
// bounds rolled-back or abandoned promotions until reconcile prunes them.
const MAX_PENDING_PROMOTIONS = MAX_CONCURRENT_TITLE_JOBS + MAX_WAITING_TITLE_JOBS;

// A committed Thread Draft promotion, recorded by the Main Process when the
// `thread-draft:promote` command is accepted. It is the only thing that makes a
// later Run eligible for automatic title generation, so the Renderer cannot
// request generation for a Thread that was never promoted from a Draft.
export type ThreadTitlePromotion = {
  threadId: string;
  runId: string;
  source: string;
};

export function registerAcceptedThreadTitlePromotion(
  registrar: { registerPromotion: (promotion: ThreadTitlePromotion) => void } | null | undefined,
  command: AppStateCommand,
  data: unknown,
) {
  if (!registrar || command.type !== "thread-draft:promote") return;
  const created = (data as { created?: unknown } | undefined)?.created;
  if (created !== true) return;
  const payload = command.payload as
    | { threadId?: unknown; titleSource?: unknown; run?: { id?: unknown } }
    | undefined;
  const threadId = payload?.threadId;
  const runId = payload?.run?.id;
  const source = payload?.titleSource;
  if (typeof threadId !== "string" || typeof runId !== "string" || typeof source !== "string") {
    return;
  }
  registrar.registerPromotion({ threadId, runId, source });
}

export type ThreadTitleJobInput = {
  threadId: string;
  runId: string;
};

type ThreadTitleJobCandidateSource = ThreadTitleJobInput & { source: string };

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
  resolveDefaultModelId: (signal: AbortSignal) => Promise<string | null>;
  transportFactory: KimiAcpTransportFactory;
  createWorkingDirectory?: () => Promise<string>;
  removeWorkingDirectory?: (cwd: string) => Promise<void>;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  log?: (diagnostic: ThreadTitleDiagnostic) => void;
};

type ThreadTitleJobCandidate = ThreadTitleJobCandidateSource & {
  expectedTitle: string;
  configuredModelId: string | undefined;
};

type AcceptedThreadTitleJob = ThreadTitleJobCandidateSource & {
  expectedTitle: string;
  modelId: string;
};

type PendingThreadTitleAdmission = {
  candidate: ThreadTitleJobCandidate;
  resolved: boolean;
  modelId: string | null;
  cancelled: boolean;
  modelResolutionController?: AbortController;
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

function titlePrompt(source: string): string {
  return [
    "Create a concise title in the language of the supplied Thread title source.",
    "For English titles, use 1-8 words.",
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
    const bounded = boundGraphemes(title, 18);
    if (bounded.count < 6) return null;
    return bounded.text;
  }

  return title;
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
  private outputOverflowed = false;
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
    modelId: string,
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

    if (!modelConfig || !supportedModels.includes(modelId)) {
      throw new Error("Snapshotted Thread title model is unavailable.");
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
    // Overflowed output is discarded, so validation rejects it as invalid.
    return { modelId, output: this.outputOverflowed ? "" : this.output };
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
    if (!text || this.outputOverflowed) return;
    // A valid payload is one small JSON object. Past the ceiling the response
    // can no longer become valid, so stop accumulating instead of holding
    // verbose or malformed output for the rest of the timeout window.
    if (this.output.length + text.length > MAX_TITLE_OUTPUT_CHARS) {
      this.output = "";
      this.outputOverflowed = true;
      return;
    }
    this.output += text;
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function eligibleJob(
  snapshot: AppStateSnapshot,
  input: ThreadTitleJobCandidateSource,
): ThreadTitleJobCandidate | null {
  if (!input.source.trim()) return null;
  const thread = (snapshot.threads ?? []).find((candidate) => candidate.id === input.threadId);
  if (!thread || thread.archived || thread.customTitle) return null;
  const threadRuns = (snapshot.threadRuns ?? []).filter((run) => run.threadId === input.threadId);
  if (threadRuns.length !== 1 || threadRuns[0]?.id !== input.runId) return null;
  return {
    ...input,
    source: boundThreadTitleSource(input.source),
    expectedTitle: thread.title,
    configuredModelId: snapshot.settings?.threadTitleModelId,
  };
}

function waitingJobIsEligible(
  snapshot: AppStateSnapshot,
  job: Pick<AcceptedThreadTitleJob, "threadId" | "expectedTitle">,
) {
  const thread = (snapshot.threads ?? []).find((candidate) => candidate.id === job.threadId);
  return !!thread && !thread.archived && !thread.customTitle && thread.title === job.expectedTitle;
}

function runningJobShouldContinue(snapshot: AppStateSnapshot, job: AcceptedThreadTitleJob) {
  const thread = (snapshot.threads ?? []).find((candidate) => candidate.id === job.threadId);
  return !!thread && !thread.archived && !thread.customTitle;
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
  const activeJobs = new Map<
    string,
    { job: AcceptedThreadTitleJob; controller: AbortController }
  >();
  const activeJobKeys = new Set<string>();
  const pendingAdmissions: PendingThreadTitleAdmission[] = [];
  const waitingJobs: AcceptedThreadTitleJob[] = [];
  // Committed draft promotions that have not yet had their first Run accepted,
  // keyed by `threadId:runId`. Recorded by the Main Process from the accepted
  // `thread-draft:promote` command, consumed by the matching `enqueue`.
  const pendingPromotions = new Map<string, ThreadTitlePromotion>();
  const defaultModelResolutions = new Set<Promise<string | null>>();
  const idleWaiters = new Set<() => void>();
  let shuttingDown = false;

  function jobKey(job: ThreadTitleJobInput) {
    return `${job.threadId}:${job.runId}`;
  }

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

  function isIdle() {
    return (
      activeTasks.size === 0 &&
      waitingJobs.length === 0 &&
      pendingAdmissions.length === 0 &&
      defaultModelResolutions.size === 0
    );
  }

  function resolveIdleWaiters() {
    if (!isIdle()) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  function resolveDefaultModel(admission: PendingThreadTitleAdmission) {
    const controller = new AbortController();
    admission.modelResolutionController = controller;
    let resolution: Promise<string | null>;
    try {
      resolution = options.resolveDefaultModelId(controller.signal);
    } catch {
      resolution = Promise.resolve(null);
    }
    const promise = resolution
      .then((modelId) => {
        const normalized = modelId?.trim();
        return normalized || null;
      })
      .catch(() => null)
      .finally(() => {
        defaultModelResolutions.delete(promise);
        resolveIdleWaiters();
      });
    defaultModelResolutions.add(promise);
    return promise;
  }

  function start(job: AcceptedThreadTitleJob) {
    const key = jobKey(job);
    const controller = new AbortController();
    const task = run(job, controller.signal).finally(() => {
      activeJobKeys.delete(key);
      activeTasks.delete(task);
      activeJobs.delete(key);
      startWaitingJobs();
      resolveIdleWaiters();
    });
    activeJobs.set(key, { job, controller });
    activeTasks.add(task);
  }

  function startWaitingJobs() {
    while (
      !shuttingDown &&
      activeTasks.size < MAX_CONCURRENT_TITLE_JOBS &&
      waitingJobs.length > 0
    ) {
      const job = waitingJobs.shift()!;
      if (!waitingJobIsEligible(options.getSnapshot(), job)) {
        activeJobKeys.delete(jobKey(job));
        continue;
      }
      start(job);
    }
  }

  function drainAdmissions() {
    while (pendingAdmissions[0]?.resolved) {
      const admission = pendingAdmissions.shift()!;
      const key = jobKey(admission.candidate);
      if (
        admission.cancelled ||
        shuttingDown ||
        !admission.modelId ||
        !waitingJobIsEligible(options.getSnapshot(), admission.candidate)
      ) {
        activeJobKeys.delete(key);
        continue;
      }
      const { configuredModelId: _configuredModelId, ...candidate } = admission.candidate;
      const job: AcceptedThreadTitleJob = { ...candidate, modelId: admission.modelId };
      if (activeTasks.size < MAX_CONCURRENT_TITLE_JOBS && waitingJobs.length === 0) start(job);
      else waitingJobs.push(job);
    }
    startWaitingJobs();
    resolveIdleWaiters();
  }

  // Records a committed Thread Draft promotion. Until the matching Run is
  // accepted this is the only record that can authorize title generation.
  function registerPromotion(promotion: ThreadTitlePromotion) {
    if (shuttingDown) return;
    // Bound here, at the trust boundary, so an unbounded Renderer-supplied
    // source is capped before it is remembered or sent to the model.
    const source = boundThreadTitleSource(promotion.source);
    if (!source.trim()) return;
    const key = jobKey(promotion);
    if (pendingPromotions.has(key)) return;
    // Drop the oldest abandoned promotion rather than growing without bound.
    if (pendingPromotions.size >= MAX_PENDING_PROMOTIONS) {
      const oldest = pendingPromotions.keys().next().value;
      if (oldest !== undefined) pendingPromotions.delete(oldest);
    }
    pendingPromotions.set(key, { ...promotion, source });
  }

  function enqueue(input: ThreadTitleJobInput) {
    if (shuttingDown) return false;
    // The trigger boundary is authoritative: only a Run belonging to a
    // promotion this process committed may start generation. A Run on any other
    // Thread — including a non-draft Thread that happens to have exactly one
    // Run — has no entry here and is skipped.
    const key = jobKey(input);
    const promotion = pendingPromotions.get(key);
    if (!promotion) return false;
    pendingPromotions.delete(key);
    const candidate = eligibleJob(options.getSnapshot(), { ...input, source: promotion.source });
    if (!candidate) return false;
    if (activeJobKeys.has(key)) return false;
    if (activeJobKeys.size >= MAX_CONCURRENT_TITLE_JOBS + MAX_WAITING_TITLE_JOBS) {
      return false;
    }
    activeJobKeys.add(key);
    const admission: PendingThreadTitleAdmission = {
      candidate,
      resolved: false,
      modelId: null as string | null,
      cancelled: false,
    };
    pendingAdmissions.push(admission);
    const modelResolution = candidate.configuredModelId
      ? Promise.resolve(candidate.configuredModelId)
      : resolveDefaultModel(admission);
    void modelResolution.then((modelId) => {
      admission.modelId = modelId;
      admission.resolved = true;
      drainAdmissions();
    });
    return true;
  }

  function reconcile(snapshot: AppStateSnapshot) {
    // Drop promotions whose Thread was rolled back, deleted, archived, or
    // manually renamed before its first Run was accepted, so a rolled-back
    // promotion can never authorize generation later.
    // Deleting the current entry during Map iteration is well-defined and does
    // not skip later entries.
    for (const [key, promotion] of pendingPromotions) {
      const thread = (snapshot.threads ?? []).find(
        (candidate) => candidate.id === promotion.threadId,
      );
      if (!thread || thread.archived || thread.customTitle) pendingPromotions.delete(key);
    }

    const retainedAdmissions = pendingAdmissions.filter((admission) => {
      if (waitingJobIsEligible(snapshot, admission.candidate)) return true;
      admission.cancelled = true;
      admission.modelResolutionController?.abort();
      activeJobKeys.delete(jobKey(admission.candidate));
      return false;
    });
    pendingAdmissions.splice(0, pendingAdmissions.length, ...retainedAdmissions);

    const retainedWaitingJobs = waitingJobs.filter((job) => {
      if (waitingJobIsEligible(snapshot, job)) return true;
      activeJobKeys.delete(jobKey(job));
      return false;
    });
    waitingJobs.splice(0, waitingJobs.length, ...retainedWaitingJobs);

    for (const { job, controller } of activeJobs.values()) {
      if (!runningJobShouldContinue(snapshot, job)) controller.abort();
    }
    drainAdmissions();
  }

  return {
    registerPromotion,
    enqueue,
    reconcile,
    waitForIdle: () => {
      if (isIdle()) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.add(resolve));
    },
    async shutdown() {
      shuttingDown = true;
      pendingPromotions.clear();
      for (const admission of pendingAdmissions.splice(0)) {
        admission.cancelled = true;
        admission.modelResolutionController?.abort();
        activeJobKeys.delete(jobKey(admission.candidate));
      }
      for (const job of waitingJobs.splice(0)) activeJobKeys.delete(jobKey(job));
      activeJobs.forEach(({ controller }) => controller.abort());
      await Promise.allSettled([...activeTasks, ...defaultModelResolutions]);
      resolveIdleWaiters();
    },
  };
}

export type ThreadTitleCoordinator = ReturnType<typeof createThreadTitleCoordinator>;
