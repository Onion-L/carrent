import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { KimiUsageStats, KimiUsageTokenTotals } from "../../src/shared/kimiUsage";

const KIMI_CODE_DIR = ".kimi-code";
const USAGE_RECORD_MARKER = '"type":"usage.record"';
const TURN_SCOPE_MARKER = '"usageScope":"turn"';
const MODEL_PREFIX = "kimi-code/";
const SCAN_CONCURRENCY = 8;

interface UsageRecord {
  time: number;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  sessionId: string | null;
}

interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  records: UsageRecord[];
}

export interface KimiUsageDeps {
  /** Defaults to os.homedir(); injectable for tests. */
  homeDir?: string;
  /** Called for every wire.jsonl that is actually parsed (cache misses only). */
  onFileScanned?: (filePath: string) => void;
}

const fileCache = new Map<string, FileCacheEntry>();

/** Test helper: drop the in-process parse cache. */
export function resetKimiUsageCache(): void {
  fileCache.clear();
}

export async function getKimiUsageStats(deps: KimiUsageDeps = {}): Promise<KimiUsageStats> {
  // Injected homeDir wins (tests); otherwise honor KIMI_CODE_HOME like the CLI,
  // falling back to the default ~/.kimi-code location.
  const kimiDir =
    deps.homeDir !== undefined
      ? path.join(deps.homeDir, KIMI_CODE_DIR)
      : (process.env.KIMI_CODE_HOME ?? path.join(os.homedir(), KIMI_CODE_DIR));
  const sessionsDir = path.join(kimiDir, "sessions");

  const workDirBySessionId = await readSessionIndex(path.join(kimiDir, "session_index.jsonl"));
  const wireFiles = await findWireFiles(sessionsDir);

  const allRecords: UsageRecord[] = [];
  for (let index = 0; index < wireFiles.length; index += SCAN_CONCURRENCY) {
    const batch = wireFiles.slice(index, index + SCAN_CONCURRENCY);
    const batchRecords = await Promise.all(
      batch.map((filePath) => readWireFileCached(filePath, deps.onFileScanned)),
    );
    for (const records of batchRecords) allRecords.push(...records);
  }

  return aggregate(allRecords, workDirBySessionId);
}

async function readSessionIndex(indexPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let content: string;
  try {
    content = await fs.readFile(indexPath, "utf8");
  } catch {
    return map;
  }

  for (const line of content.split("\n")) {
    if (!line.includes('"sessionId"')) continue;
    try {
      const parsed = JSON.parse(line) as { sessionId?: unknown; workDir?: unknown };
      if (typeof parsed.sessionId === "string" && typeof parsed.workDir === "string") {
        map.set(parsed.sessionId, parsed.workDir);
      }
    } catch {
      // Skip malformed index lines.
    }
  }
  return map;
}

async function findWireFiles(sessionsDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === "wire.jsonl") {
        files.push(fullPath);
      }
    }
  }

  await walk(sessionsDir);
  return files;
}

/** Extracts `session_<id>` from `.../sessions/<wd_*>/<session_*>/agents/<agent>/wire.jsonl`. */
function extractSessionId(filePath: string): string | null {
  const match = /[/\\](session_[^/\\]+)[/\\]agents[/\\]/u.exec(filePath);
  return match?.[1] ?? null;
}

async function readWireFileCached(
  filePath: string,
  onFileScanned?: (filePath: string) => void,
): Promise<UsageRecord[]> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    fileCache.delete(filePath);
    return [];
  }

  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.records;
  }

  const records = await parseWireFile(filePath);
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, records });
  onFileScanned?.(filePath);
  return records;
}

async function parseWireFile(filePath: string): Promise<UsageRecord[]> {
  const sessionId = extractSessionId(filePath);
  const records: UsageRecord[] = [];

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      // Cheap substring filters before paying for JSON.parse on 100MB of wire.
      if (!line.includes(USAGE_RECORD_MARKER) || !line.includes(TURN_SCOPE_MARKER)) continue;

      try {
        const parsed = JSON.parse(line) as {
          model?: unknown;
          time?: unknown;
          usage?: {
            inputOther?: unknown;
            output?: unknown;
            inputCacheRead?: unknown;
            inputCacheCreation?: unknown;
          };
        };
        const usage = parsed.usage;
        if (typeof parsed.time !== "number" || !usage) continue;

        records.push({
          time: parsed.time,
          model: normalizeModel(parsed.model),
          input: toCount(usage.inputOther),
          output: toCount(usage.output),
          cacheRead: toCount(usage.inputCacheRead),
          cacheCreation: toCount(usage.inputCacheCreation),
          sessionId,
        });
      } catch {
        // Skip malformed lines.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return records;
}

function normalizeModel(model: unknown): string {
  const raw = typeof model === "string" && model !== "" ? model : "unknown";
  return raw.startsWith(MODEL_PREFIX) ? raw.slice(MODEL_PREFIX.length) : raw;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function toLocalDay(time: number): string {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyTotals(): KimiUsageTokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
}

function addTo(totals: KimiUsageTokenTotals, record: UsageRecord): void {
  totals.input += record.input;
  totals.output += record.output;
  totals.cacheRead += record.cacheRead;
  totals.cacheCreation += record.cacheCreation;
  totals.total += record.input + record.output + record.cacheRead + record.cacheCreation;
}

function aggregate(
  records: UsageRecord[],
  workDirBySessionId: Map<string, string>,
): KimiUsageStats {
  const dayMap = new Map<string, Map<string, KimiUsageTokenTotals>>();
  const models: Record<string, KimiUsageTokenTotals> = {};
  const projectMap = new Map<string, KimiUsageTokenTotals>();
  const sessionIds = new Set<string>();
  let firstActivityAt: number | null = null;
  let lastActivityAt: number | null = null;

  for (const record of records) {
    if (record.sessionId !== null) sessionIds.add(record.sessionId);

    firstActivityAt =
      firstActivityAt === null ? record.time : Math.min(firstActivityAt, record.time);
    lastActivityAt = lastActivityAt === null ? record.time : Math.max(lastActivityAt, record.time);

    const day = toLocalDay(record.time);
    let dayModels = dayMap.get(day);
    if (!dayModels) {
      dayModels = new Map();
      dayMap.set(day, dayModels);
    }
    let dayModelTotals = dayModels.get(record.model);
    if (!dayModelTotals) {
      dayModelTotals = emptyTotals();
      dayModels.set(record.model, dayModelTotals);
    }
    addTo(dayModelTotals, record);

    const modelTotals = (models[record.model] ??= emptyTotals());
    addTo(modelTotals, record);

    const workDir =
      record.sessionId === null ? undefined : workDirBySessionId.get(record.sessionId);
    if (workDir !== undefined) {
      let projectTotals = projectMap.get(workDir);
      if (!projectTotals) {
        projectTotals = emptyTotals();
        projectMap.set(workDir, projectTotals);
      }
      addTo(projectTotals, record);
    }
  }

  const days = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, byModel]) => ({ date, byModel: Object.fromEntries(byModel) }));

  const projects = [...projectMap.entries()]
    .map(([workDir, totals]) => ({ workDir, name: path.basename(workDir), totals }))
    .sort((a, b) => b.totals.total - a.totals.total);

  return {
    days,
    models,
    projects,
    sessionCount: sessionIds.size,
    firstActivityAt,
    lastActivityAt,
    scannedAt: new Date().toISOString(),
  };
}
