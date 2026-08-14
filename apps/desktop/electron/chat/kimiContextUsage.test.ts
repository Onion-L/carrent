import { beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getKimiContextUsage,
  parseContextLimitFromToml,
  resetModelsCatalogCache,
  scanWireLines,
} from "./kimiContextUsage";

let homeDir: string;

function line(type: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, ...overrides });
}

function usageLine(usage: Record<string, number>, overrides: Record<string, unknown> = {}): string {
  return line("usage.record", {
    model: "kimi-code/kimi-for-coding",
    usage,
    usageScope: "turn",
    time: 1786640653858,
    ...overrides,
  });
}

function stepEndLine(usage: Record<string, number>): string {
  return line("context.append_loop_event", {
    event: { type: "step.end", uuid: "step-1", turnId: "0", step: 1, usage },
    time: 1786640653858,
  });
}

function llmRequestLine(model: string, modelAlias = model): string {
  return line("llm.request", {
    kind: "loop",
    provider: "kimi",
    model,
    modelAlias,
    maxTokens: 262144,
    time: 1786640648700,
  });
}

function fullUsage(inputOther: number, output: number, read: number, creation: number) {
  return { inputOther, output, inputCacheRead: read, inputCacheCreation: creation };
}

async function writeWire(sessionId: string, lines: string[], bucket = "wd_test_0001") {
  const dir = path.join(homeDir, ".kimi-code", "sessions", bucket, sessionId, "agents", "main");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "wire.jsonl");
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

async function writeSessionIndex(
  entries: Array<{ sessionId: string; bucket?: string }>,
  options: { omitSessionDir?: boolean } = {},
) {
  const kimiDir = path.join(homeDir, ".kimi-code");
  await fs.mkdir(kimiDir, { recursive: true });
  const lines = entries.map((entry) =>
    JSON.stringify({
      sessionId: entry.sessionId,
      ...(options.omitSessionDir
        ? {}
        : {
            sessionDir: path.join(
              kimiDir,
              "sessions",
              entry.bucket ?? "wd_test_0001",
              entry.sessionId,
            ),
          }),
      workDir: "/code/carrent",
    }),
  );
  await fs.writeFile(path.join(kimiDir, "session_index.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

function fakeCatalogFetch(context: number | undefined): typeof fetch {
  const responder = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        "kimi-for-coding": {
          models: {
            "kimi-for-coding": { limit: { context } },
            "kimi-for-coding-highspeed": { limit: { context } },
            k3: { limit: { context } },
            "k3-256k": { limit: { context } },
          },
        },
      }),
      { status: 200 },
    );
  return responder as unknown as typeof fetch;
}

beforeEach(async () => {
  resetModelsCatalogCache();
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-context-usage-test-"));
});

describe("scanWireLines", () => {
  it("sums all four usage fields of the last usage.record", () => {
    const scan = scanWireLines([
      llmRequestLine("kimi-for-coding", "kimi-code/kimi-for-coding"),
      usageLine(fullUsage(3887, 133, 17920, 0)),
      usageLine(fullUsage(100, 10, 50, 5)),
    ]);
    expect(scan).toEqual({
      used: 165,
      model: "kimi-for-coding",
      modelAlias: "kimi-code/kimi-for-coding",
    });
  });

  it("reads the fill from a step.end loop event", () => {
    const scan = scanWireLines([stepEndLine(fullUsage(473, 146, 107264, 0))]);
    expect(scan?.used).toBe(107883);
  });

  it("prefers the most recent record across kinds", () => {
    const scan = scanWireLines([
      usageLine(fullUsage(1, 1, 1, 1)),
      line("context.apply_compaction", {
        summary: "compacted",
        tokensBefore: 200550,
        tokensAfter: 1301,
        time: 1786078370548,
      }),
    ]);
    expect(scan?.used).toBe(1301);
  });

  it("resets to zero after a context.clear", () => {
    const scan = scanWireLines([usageLine(fullUsage(10, 10, 10, 10)), line("context.clear")]);
    expect(scan?.used).toBe(0);
  });

  it("lets a later usage record win over an earlier clear", () => {
    const scan = scanWireLines([line("context.clear"), usageLine(fullUsage(2, 2, 2, 2))]);
    expect(scan?.used).toBe(8);
  });

  it("reads the v1 update_token_count record", () => {
    const scan = scanWireLines([line("context.update_token_count", { tokenCount: 4242 })]);
    expect(scan?.used).toBe(4242);
  });

  it("returns null when no usage-bearing record exists", () => {
    const scan = scanWireLines([
      line("metadata", { protocol_version: "1.4", created_at: 1786640648647 }),
      llmRequestLine("kimi-for-coding"),
      line("context.append_message", { message: { role: "user" } }),
    ]);
    expect(scan).toBeNull();
  });

  it("ignores malformed lines instead of failing the scan", () => {
    const scan = scanWireLines([
      '{"type":"usage.record","usage":{"inputOther":"x"',
      usageLine(fullUsage(3, 3, 3, 3)),
    ]);
    expect(scan?.used).toBe(12);
  });

  it("takes the model from the last llm.request record", () => {
    const scan = scanWireLines([
      llmRequestLine("kimi-for-coding", "kimi-code/kimi-for-coding"),
      llmRequestLine("kimi-for-coding-highspeed", "kimi-code/kimi-for-coding-highspeed"),
      usageLine(fullUsage(1, 1, 1, 1), { model: "stale-model" }),
    ]);
    expect(scan?.model).toBe("kimi-for-coding-highspeed");
    expect(scan?.modelAlias).toBe("kimi-code/kimi-for-coding-highspeed");
  });
});

describe("getKimiContextUsage", () => {
  it("locates the wire file through the session index", async () => {
    await writeSessionIndex([{ sessionId: "session-indexed" }]);
    await writeWire("session-indexed", [usageLine(fullUsage(10, 20, 30, 40))], "wd_other_2222");

    const usage = await getKimiContextUsage({ sessionId: "session-indexed", homeDir });
    expect(usage).toEqual({ used: 100 });
  });

  it("falls back to scanning buckets when the index lacks the entry", async () => {
    await writeSessionIndex([{ sessionId: "session-unrelated" }]);
    await writeWire("session-globbed", [usageLine(fullUsage(1, 2, 3, 4))], "wd_hashbucket_9999");

    const usage = await getKimiContextUsage({ sessionId: "session-globbed", homeDir });
    expect(usage).toEqual({ used: 10 });
  });

  it("returns null when the session has no wire file", async () => {
    const usage = await getKimiContextUsage({ sessionId: "session-missing", homeDir });
    expect(usage).toBeNull();
  });

  it("drops a truncated final line written mid-flush", async () => {
    const filePath = await writeWire("session-truncated", [usageLine(fullUsage(5, 5, 5, 5))]);
    await fs.appendFile(filePath, '{"type":"usage.record","usage":{"inputOther":999');

    const usage = await getKimiContextUsage({ sessionId: "session-truncated", homeDir });
    expect(usage).toEqual({ used: 20 });
  });

  it("streams the whole file when the tail window holds no usage record", async () => {
    // Pad the file past the tail window with non-usage records, keeping the
    // only usage record at the very top of the file.
    const padding = Array.from({ length: 4_000 }, (_, index) =>
      line("context.append_loop_event", {
        event: { type: "step.begin", uuid: `step-${index}`, turnId: "0", step: index },
        time: 1786640648700 + index,
      }),
    );
    await writeWire("session-padded", [usageLine(fullUsage(7, 7, 7, 7)), ...padding]);

    const usage = await getKimiContextUsage({ sessionId: "session-padded", homeDir });
    expect(usage).toEqual({ used: 28 });
  });

  it("streams the whole file when the tail has usage but not the latest model request", async () => {
    const padding = Array.from({ length: 4_000 }, (_, index) =>
      line("context.append_loop_event", {
        event: { type: "step.begin", uuid: `step-${index}`, turnId: "0", step: index },
        time: 1786640648700 + index,
      }),
    );
    await writeWire("session-model-before-tail", [
      llmRequestLine("k3", "kimi-code/k3"),
      ...padding,
      usageLine(fullUsage(7, 7, 7, 7)),
    ]);

    const usage = await getKimiContextUsage({
      sessionId: "session-model-before-tail",
      homeDir,
      fetchImpl: fakeCatalogFetch(1_048_576),
    });
    expect(usage).toEqual({ used: 28, total: 1_048_576, model: "k3" });
  });

  it("resolves total from config.toml before the catalog and builtin map", async () => {
    const kimiDir = path.join(homeDir, ".kimi-code");
    await fs.mkdir(kimiDir, { recursive: true });
    await fs.writeFile(
      path.join(kimiDir, "config.toml"),
      [
        '[models."kimi-code/kimi-for-coding"]',
        'provider = "managed:kimi-code"',
        "max_context_size = 262144",
        "",
        '[models."kimi-code/k3"]',
        "max_context_size = 1048576",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeSessionIndex([{ sessionId: "session-config" }]);
    await writeWire("session-config", [
      llmRequestLine("kimi-for-coding", "kimi-code/kimi-for-coding"),
      usageLine(fullUsage(1, 1, 1, 1)),
    ]);

    const catalogCalls: string[] = [];
    const usage = await getKimiContextUsage({
      sessionId: "session-config",
      homeDir,
      fetchImpl: (async (input) => {
        catalogCalls.push(String(input));
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(usage).toEqual({ used: 4, total: 262144, model: "kimi-for-coding" });
    expect(catalogCalls).toEqual([]);
  });

  it("resolves total from the models.dev catalog when config has no entry", async () => {
    await writeSessionIndex([{ sessionId: "session-catalog" }]);
    await writeWire("session-catalog", [
      llmRequestLine("k3", "kimi-code/k3"),
      usageLine(fullUsage(1, 1, 1, 1)),
    ]);

    const usage = await getKimiContextUsage({
      sessionId: "session-catalog",
      homeDir,
      fetchImpl: fakeCatalogFetch(1_048_576),
    });
    expect(usage).toEqual({ used: 4, total: 1048576, model: "k3" });
  });

  it("omits total when the catalog cannot resolve a known alias", async () => {
    await writeSessionIndex([{ sessionId: "session-unresolved" }]);
    await writeWire("session-unresolved", [
      llmRequestLine("k3-256k", "kimi-code/k3-256k"),
      usageLine(fullUsage(1, 1, 1, 1)),
    ]);

    const usage = await getKimiContextUsage({
      sessionId: "session-unresolved",
      homeDir,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    expect(usage).toEqual({ used: 4, model: "k3-256k" });
  });

  it("omits total for an unknown alias", async () => {
    await writeSessionIndex([{ sessionId: "session-unknown" }]);
    await writeWire("session-unknown", [
      llmRequestLine("mystery-model", "kimi-code/mystery-model"),
      usageLine(fullUsage(1, 1, 1, 1)),
    ]);

    let catalogCalls = 0;
    const usage = await getKimiContextUsage({
      sessionId: "session-unknown",
      homeDir,
      fetchImpl: async () => {
        catalogCalls += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(usage).toEqual({ used: 4, model: "mystery-model" });
    expect(catalogCalls).toBe(0);
  });
});

describe("parseContextLimitFromToml", () => {
  it("matches quoted and plain model section headers", () => {
    const content = [
      '[models."kimi-code/k3"]',
      "max_context_size = 1048576",
      "[models.plain]",
      "max_context_size = 8192",
    ].join("\n");
    expect(parseContextLimitFromToml(content, "kimi-code/k3")).toBe(1048576);
    expect(parseContextLimitFromToml(content, "plain")).toBe(8192);
    expect(parseContextLimitFromToml(content, "missing")).toBeUndefined();
  });

  it("does not leak keys across sections", () => {
    const content = [
      '[models."kimi-code/k3"]',
      "max_context_size = 1048576",
      "[other]",
      "max_context_size = 100",
    ].join("\n");
    expect(parseContextLimitFromToml(content, "kimi-code/k3")).toBe(1048576);
  });
});
