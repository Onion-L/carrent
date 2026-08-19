import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import readline from "node:readline";

import type { RuntimeDebugRecord, RuntimeDebugTrace } from "../../src/shared/runtimeDebug";
import { locateKimiWireFile, resolveKimiCodeHome } from "./kimiContextUsage";

const MAX_PARSE_ERROR_VALUE_CHARS = 4_096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function debugRecord(raw: Record<string, unknown>, sequence: number): RuntimeDebugRecord {
  return {
    sequence,
    type: typeof raw.type === "string" ? raw.type : "wire.unknown",
    ...(typeof raw.time === "number" ? { time: raw.time } : {}),
    raw,
  };
}

function isPinnedRecord(record: RuntimeDebugRecord) {
  return record.type === "metadata" || record.type === "profile.bind";
}

export async function readKimiDebugTrace(options: {
  sessionId: string;
  homeDir?: string;
  maxBytes?: number;
}): Promise<RuntimeDebugTrace | null> {
  const wirePath = await locateKimiWireFile(
    resolveKimiCodeHome(options.homeDir),
    options.sessionId,
  );
  if (!wirePath) return null;

  const stat = await fs.stat(wirePath);
  const fileSize = stat.size;
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const records: RuntimeDebugRecord[] = [];
  const recordBytes: number[] = [];
  let retainedBytes = 0;
  let parseErrorCount = 0;
  let truncated = false;
  let sequence = 0;

  const lines = readline.createInterface({
    input: createReadStream(wirePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line.trim()) continue;
    sequence += 1;
    let record: RuntimeDebugRecord;
    try {
      const parsed = JSON.parse(line) as unknown;
      record = debugRecord(
        isRecord(parsed) ? parsed : { type: "wire.parse_error", line: sequence, value: parsed },
        sequence,
      );
      if (!isRecord(parsed)) parseErrorCount += 1;
    } catch {
      parseErrorCount += 1;
      record = debugRecord(
        {
          type: "wire.parse_error",
          line: sequence,
          value: line.slice(0, MAX_PARSE_ERROR_VALUE_CHARS),
        },
        sequence,
      );
    }

    const bytes = Buffer.byteLength(JSON.stringify(record.raw));
    records.push(record);
    recordBytes.push(bytes);
    retainedBytes += bytes;

    while (retainedBytes > maxBytes && records.length > 1) {
      const removableIndex = records.findIndex((candidate) => !isPinnedRecord(candidate));
      if (removableIndex < 0) break;
      retainedBytes -= recordBytes[removableIndex]!;
      records.splice(removableIndex, 1);
      recordBytes.splice(removableIndex, 1);
      truncated = true;
    }
  }

  return {
    runtimeId: "kimi",
    sessionId: options.sessionId,
    source: "kimi-wire",
    sourcePath: wirePath,
    loadedAt: new Date().toISOString(),
    fileSize,
    modifiedAt: stat.mtimeMs,
    truncated,
    parseErrorCount,
    records,
  };
}
