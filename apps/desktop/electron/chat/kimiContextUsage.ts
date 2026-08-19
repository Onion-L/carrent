import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const KIMI_CODE_DIR = ".kimi-code";
// Tail window for the fast path: several exchanges of wire records fit in a
// fraction of this, so the common hover-status scan never reads whole files.
const TAIL_WINDOW_BYTES = 262_144;
const MODELS_CATALOG_URL = "https://models.dev/api.json";
const MODELS_CATALOG_TIMEOUT_MS = 3_000;
// The models.dev catalog keys Kimi models under this provider id, while the
// wire log's model alias is prefixed `kimi-code/`.
const CATALOG_MODEL_LOOKUPS: Record<string, { providerId: string; modelId: string }> = {
  "kimi-code/kimi-for-coding": {
    providerId: "kimi-for-coding",
    modelId: "kimi-for-coding",
  },
  "kimi-code/kimi-for-coding-highspeed": {
    providerId: "kimi-for-coding",
    modelId: "kimi-for-coding-highspeed",
  },
  "kimi-code/k3": { providerId: "kimi-for-coding", modelId: "k3" },
  "kimi-code/k3-256k": { providerId: "kimi-for-coding", modelId: "k3-256k" },
};

export type KimiContextUsage = {
  used: number;
  total?: number;
  model?: string;
};

export type KimiContextUsageDeps = {
  /** Defaults to os.homedir(); injectable for tests. */
  homeDir?: string;
  /** Injectable fetch for the models.dev catalog fallback. */
  fetchImpl?: typeof fetch;
};

type WireUsageScan = {
  used: number;
  model?: string;
  modelAlias?: string;
};

/**
 * Reconstructs the session's context fill from the kimi-code wire log.
 *
 * The wire value is the "last measured" fill (request input + output of the
 * latest exchange); it agrees with the CLI's own panel after every API
 * response and is only slightly lower mid-turn.
 */
export async function getKimiContextUsage(
  options: { sessionId: string } & KimiContextUsageDeps,
): Promise<KimiContextUsage | null> {
  const kimiDir = resolveKimiCodeHome(options.homeDir);
  const wirePath = await locateKimiWireFile(kimiDir, options.sessionId);
  if (!wirePath) return null;

  const scan = await scanWireFile(wirePath);
  if (!scan) return null;

  const total = await resolveContextTotal(kimiDir, scan.modelAlias, options.fetchImpl);
  return {
    used: scan.used,
    ...(total !== undefined ? { total } : {}),
    ...(scan.model !== undefined ? { model: scan.model } : {}),
  };
}

export function resolveKimiCodeHome(homeDir?: string): string {
  if (homeDir !== undefined) {
    return path.join(homeDir, KIMI_CODE_DIR);
  }
  return process.env.KIMI_CODE_HOME ?? path.join(os.homedir(), KIMI_CODE_DIR);
}

// --- Session wire file location ----------------------------------------------

export async function locateKimiWireFile(
  kimiDir: string,
  sessionId: string,
): Promise<string | null> {
  // The session index carries absolute session dirs; prefer it over scanning.
  try {
    const content = await fs.readFile(path.join(kimiDir, "session_index.jsonl"), "utf8");
    for (const line of content.split("\n")) {
      if (!line.includes('"sessionId"')) continue;
      try {
        const parsed = JSON.parse(line) as { sessionId?: unknown; sessionDir?: unknown };
        if (parsed.sessionId !== sessionId || typeof parsed.sessionDir !== "string") continue;
        const candidate = path.join(parsed.sessionDir, "agents", "main", "wire.jsonl");
        if (await isFile(candidate)) return candidate;
      } catch {
        // Skip malformed index lines.
      }
    }
  } catch {
    // A missing index falls through to the bucket scan.
  }

  // Buckets are `<slug>_<hash>`; matching the session dir by name avoids
  // reimplementing the workDir hash.
  const sessionsDir = path.join(kimiDir, "sessions");
  try {
    for (const bucket of await fs.readdir(sessionsDir)) {
      const candidate = path.join(sessionsDir, bucket, sessionId, "agents", "main", "wire.jsonl");
      if (await isFile(candidate)) return candidate;
    }
  } catch {
    // No sessions directory.
  }
  return null;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

// --- Wire scanning ------------------------------------------------------------

/**
 * Pure scan rule over wire lines: the most recent usage-bearing record wins.
 * `usage.record` and `step.end` give the four-field token sum,
 * `apply_compaction` gives `tokensAfter`, `clear` resets to 0, and the v1
 * `update_token_count` record gives its count. The model comes from the last
 * `llm.request` record regardless of position.
 */
export function scanWireLines(lines: readonly string[]): WireUsageScan | null {
  const state = createWireScanState();
  for (const line of lines) {
    state.consume(line);
  }
  return state.result();
}

function createWireScanState(): {
  consume: (line: string) => void;
  result: () => WireUsageScan | null;
} {
  let used: number | null = null;
  let model: string | undefined;
  let modelAlias: string | undefined;

  return {
    consume(line: string) {
      if (!line.includes('"type":"')) return;

      if (line.includes('"type":"llm.request"')) {
        try {
          const parsed = JSON.parse(line) as { model?: unknown; modelAlias?: unknown };
          if (typeof parsed.model === "string" && parsed.model !== "") {
            model = parsed.model;
            modelAlias = typeof parsed.modelAlias === "string" ? parsed.modelAlias : undefined;
          }
        } catch {
          // Skip malformed lines.
        }
        return;
      }

      let fill: number | null = null;
      if (line.includes('"type":"usage.record"')) {
        fill = readUsageFill(safeJsonParse(line)?.usage);
      } else if (line.includes('"type":"context.append_loop_event"')) {
        if (!line.includes('"type":"step.end"')) return;
        const event = safeJsonParse(line)?.event as { usage?: unknown } | undefined;
        fill = readUsageFill(event?.usage);
      } else if (line.includes('"type":"context.apply_compaction"')) {
        fill = readNonNegativeInteger(safeJsonParse(line)?.tokensAfter);
      } else if (line.includes('"type":"context.update_token_count"')) {
        fill = readNonNegativeInteger(safeJsonParse(line)?.tokenCount);
      } else if (line.includes('"type":"context.clear"')) {
        fill = 0;
      } else {
        return;
      }

      if (fill !== null) used = fill;
    },
    result: () =>
      used === null
        ? null
        : {
            used,
            ...(model !== undefined
              ? { model, ...(modelAlias !== undefined ? { modelAlias } : {}) }
              : {}),
          },
  };
}

function safeJsonParse(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Context fill = full request input + output across all cache fields. */
function readUsageFill(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const fields = [
    record.inputOther,
    record.output,
    record.inputCacheRead,
    record.inputCacheCreation,
  ];
  if (!fields.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    return null;
  }
  return fields.reduce((sum: number, value) => sum + (value as number), 0);
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function scanWireFile(wirePath: string): Promise<WireUsageScan | null> {
  let stat;
  try {
    stat = await fs.stat(wirePath);
  } catch {
    return null;
  }

  const handle = await fs.open(wirePath, "r");
  try {
    const windowSize = Math.min(stat.size, TAIL_WINDOW_BYTES);
    const buffer = Buffer.alloc(windowSize);
    await handle.read(buffer, 0, windowSize, stat.size - windowSize);
    const tailLines = splitTailLines(buffer.toString("utf8"), windowSize < stat.size);
    const scan = scanWireLines(tailLines);
    if (windowSize >= stat.size) return scan;
    const tailHasModelRequest = tailLines.some((line) => line.includes('"type":"llm.request"'));
    if (scan?.modelAlias || tailHasModelRequest) return scan;
    // The tail lacks either usage or the model request needed to resolve total.
    return await streamScanWireFile(wirePath);
  } finally {
    await handle.close();
  }
}

function splitTailLines(text: string, startedMidLine: boolean): string[] {
  let body = text;
  if (startedMidLine) {
    // The first line is a fragment of a record cut by the window offset.
    const firstNewline = body.indexOf("\n");
    body = firstNewline === -1 ? "" : body.slice(firstNewline + 1);
  }
  let lines = body.split("\n");
  if (!body.endsWith("\n")) {
    // A final line without a terminator may be mid-flush; drop it.
    lines = lines.slice(0, -1);
  }
  return lines.filter((line) => line.length > 0);
}

async function streamScanWireFile(wirePath: string): Promise<WireUsageScan | null> {
  const state = createWireScanState();
  const stream = createReadStream(wirePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      state.consume(line);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return state.result();
}

// --- Context window (total) resolution ---------------------------------------

async function resolveContextTotal(
  kimiDir: string,
  modelAlias: string | undefined,
  fetchImpl?: typeof fetch,
): Promise<number | undefined> {
  if (!modelAlias) return undefined;

  const fromConfig = await readConfigContextLimit(kimiDir, modelAlias);
  if (fromConfig !== undefined) return fromConfig;

  const fromCatalog = await fetchCatalogContextLimit(modelAlias, fetchImpl);
  if (fromCatalog !== undefined) return fromCatalog;

  return undefined;
}

async function readConfigContextLimit(kimiDir: string, alias: string): Promise<number | undefined> {
  let content: string;
  try {
    content = await fs.readFile(path.join(kimiDir, "config.toml"), "utf8");
  } catch {
    return undefined;
  }
  return parseContextLimitFromToml(content, alias);
}

/** Matches `[models."<alias>"]` sections and their `max_context_size` key. */
export function parseContextLimitFromToml(content: string, alias: string): number | undefined {
  const quotedHeader = `[models."${alias}"]`;
  const plainHeader = `[models.${alias}]`;
  let inSection = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed === quotedHeader || trimmed === plainHeader;
      continue;
    }
    if (!inSection) continue;
    const match = /^\s*max_context_size\s*=\s*(\d+)\s*(?:#.*)?$/u.exec(line);
    if (match) return Number.parseInt(match[1]!, 10);
  }
  return undefined;
}

let catalogCache: Promise<Record<string, unknown>> | null = null;

/** Test helper: drop the in-process models.dev catalog cache. */
export function resetModelsCatalogCache(): void {
  catalogCache = null;
}

async function fetchCatalogContextLimit(
  modelAlias: string,
  fetchImpl?: typeof fetch,
): Promise<number | undefined> {
  const lookup = CATALOG_MODEL_LOOKUPS[modelAlias];
  if (!lookup) return undefined;

  const fetchFn = fetchImpl ?? fetch;
  if (!fetchFn) return undefined;

  if (!catalogCache) {
    catalogCache = fetchFn(MODELS_CATALOG_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(MODELS_CATALOG_TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`models.dev responded ${response.status}.`);
        return response.json() as Promise<Record<string, unknown>>;
      })
      .catch(() => {
        // Retry on the next lookup instead of caching the failure.
        catalogCache = null;
        return {};
      });
  }

  let provider: unknown;
  try {
    provider = (await catalogCache)[lookup.providerId];
  } catch {
    return undefined;
  }
  if (!provider || typeof provider !== "object") return undefined;

  const models = (provider as Record<string, unknown>).models;
  if (!models || typeof models !== "object") return undefined;

  const model = (models as Record<string, unknown>)[lookup.modelId];
  if (!model || typeof model !== "object") return undefined;

  const limit = (model as Record<string, unknown>).limit;
  if (!limit || typeof limit !== "object") return undefined;

  return readNonNegativeInteger((limit as Record<string, unknown>).context) ?? undefined;
}
