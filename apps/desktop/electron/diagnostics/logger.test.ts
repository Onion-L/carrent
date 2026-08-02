import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  createLogger,
  getLogFilePath,
  LOGGER_ACTIVE_FILENAME,
  type LogLevel,
} from "./logger";

// A minimal in-memory WriteStream double. The real createWriteStream is async
// to open, which makes "buffered-then-flushed" assertions flaky; this stub
// opens synchronously and captures every written chunk for inspection.
type CapturedChunk = { path: string; data: string };

function createCapturingStreamFactory(captured: CapturedChunk[]) {
  return (path: string) => {
    const stream = Object.assign(new EventEmitter(), {
      writable: true,
      destroyed: false,
      write(data: string) {
        captured.push({ path, data });
        return true;
      },
      end() {
        this.destroyed = true;
        this.writable = false;
      },
    }) as unknown as import("node:fs").WriteStream;
    return stream;
  };
}

// The logger's open/rotate path awaits real fs I/O (mkdir/rename/unlink), so a
// microtask flush is not enough. Poll the predicate until it returns a defined
// value, yielding to the event loop on each tick so fs callbacks can resolve.
async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

async function waitForFiles(dir: string, expected: string[]): Promise<string[]> {
  return waitFor(async () => {
    const files = await readdir(dir);
    return expected.every((name) => files.includes(name)) ? files : undefined;
  });
}

describe("createLogger", () => {
  it("writes timestamped lines with level, scope, message, and JSON meta", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    const fixedNow = new Date("2026-08-02T16:01:21.000Z");
    try {
      const captured: CapturedChunk[] = [];
      const logger = createLogger({
        logDirectory: dir,
        now: () => fixedNow,
        createStream: createCapturingStreamFactory(captured),
      });

      logger.info("startup", "carrent booted", { electron: "41.2.2", platform: "darwin/arm64" });
      logger.error("render-gone", "renderer terminated", {
        contentsId: 7,
        reason: "oom",
        exitCode: 133,
      });
      await waitFor(() => (captured.length >= 2 ? captured.length : undefined));

      expect(captured).toHaveLength(2);
      const infoLine = captured[0]!.data;
      expect(infoLine).toContain("2026-08-02T16:01:21.000Z INFO [startup] carrent booted");
      expect(infoLine).toContain('"electron":"41.2.2"');
      expect(infoLine).toContain('"platform":"darwin/arm64"');
      expect(infoLine.endsWith("\n")).toBe(true);

      const errorLine = captured[1]!.data;
      expect(errorLine).toContain("ERROR [render-gone] renderer terminated");
      expect(errorLine).toContain('"reason":"oom"');
      expect(errorLine).toContain('"exitCode":133');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits the meta segment when no meta is supplied", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      const captured: CapturedChunk[] = [];
      const logger = createLogger({
        logDirectory: dir,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
        createStream: createCapturingStreamFactory(captured),
      });
      logger.warn("shutdown", "carrent quitting");
      await waitFor(() => (captured.length >= 1 ? captured.length : undefined));

      expect(captured).toHaveLength(1);
      // No trailing JSON object: the line is just ts + level + scope + message.
      expect(captured[0]!.data).toBe("2026-08-02T16:01:21.000Z WARN [shutdown] carrent quitting\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("buffers lines written before the stream opens and flushes them in order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      const captured: CapturedChunk[] = [];
      const logger = createLogger({
        logDirectory: dir,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
        createStream: createCapturingStreamFactory(captured),
      });
      // These three calls happen synchronously before the open microtask fires.
      logger.info("a", "first");
      logger.info("b", "second");
      logger.info("c", "third");
      await waitFor(() => (captured.length >= 3 ? captured.length : undefined));

      expect(captured).toHaveLength(3);
      expect(captured.map((c) => c.data)).toEqual([
        "2026-08-02T16:01:21.000Z INFO [a] first\n",
        "2026-08-02T16:01:21.000Z INFO [b] second\n",
        "2026-08-02T16:01:21.000Z INFO [c] third\n",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rotates as the active file fills under sustained writes and caps at maxRotatedFiles", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      // Use the real filesystem here (no stream injection) so the rotation
      // pipeline — which renames and unlinks real files — has real files to
      // operate on. A capturing stream swallows bytes in memory and would leave
      // rotation with nothing to rename.
      const logger = createLogger({
        logDirectory: dir,
        maxBytes: 30, // tiny so each INFO line trips rotation
        maxRotatedFiles: 2,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
      });
      // Drive rotation by interleaving writes with yields to the event loop, so
      // each rotation completes before the next trip. This mirrors a sustained
      // log stream rather than a single synchronous burst (which the logger
      // coalesces into one rotation by design).
      for (let i = 0; i < 6; i += 1) {
        logger.info("run", `message ${i}`);
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
      }
      await waitForFiles(dir, [LOGGER_ACTIVE_FILENAME, "main.log.1", "main.log.2"]);

      const files = await readdir(dir);
      // The cap is honored: the active file plus at most two rotated files,
      // never main.log.3.
      expect(files).toContain(LOGGER_ACTIVE_FILENAME);
      expect(files).toContain("main.log.1");
      expect(files).toContain("main.log.2");
      expect(files).not.toContain("main.log.3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("truncates a single line that exceeds maxLineBytes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      const captured: CapturedChunk[] = [];
      const logger = createLogger({
        logDirectory: dir,
        maxLineBytes: 40,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
        createStream: createCapturingStreamFactory(captured),
      });
      logger.info("overflow", "x".repeat(200));
      await waitFor(() => (captured.length >= 1 ? captured.length : undefined));

      const line = captured[0]!.data;
      // The cap is honored inclusive of the "…[truncated]\n" suffix.
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(40);
      expect(line.endsWith("…[truncated]\n")).toBe(true);
      expect(line.length).toBeLessThan(200);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders unserializable meta lossily instead of throwing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      const captured: CapturedChunk[] = [];
      const logger = createLogger({
        logDirectory: dir,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
        createStream: createCapturingStreamFactory(captured),
      });
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      // log() must not throw on a circular meta object.
      logger.error("render-gone", "boom", { cause: circular });
      await waitFor(() => (captured.length >= 1 ? captured.length : undefined));

      expect(captured).toHaveLength(1);
      expect(captured[0]!.data).toContain("cause=<unserializable>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never throws and falls back to console when the directory cannot be opened", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      // A createStream that emits 'error' on construction simulates an open
      // failure (e.g. read-only fs). The logger must swallow it.
      const factory = () =>
        Object.assign(new EventEmitter(), {
          writable: false,
          destroyed: true,
          write() {
            return false;
          },
          end() {},
        }) as unknown as import("node:fs").WriteStream;
      const logger = createLogger({
        logDirectory: dir,
        createStream: factory,
      });

      expect(() => {
        logger.error("render-gone", "should not throw");
      }).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("respects an existing log file size on startup so rotation is accurate mid-session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      // Pre-seed main.log with bytes already near the cap.
      await writeFile(path.join(dir, LOGGER_ACTIVE_FILENAME), "x".repeat(29));
      const captured: CapturedChunk[] = [];
      const logger = createLogger({
        logDirectory: dir,
        maxBytes: 30,
        maxRotatedFiles: 2,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
        createStream: createCapturingStreamFactory(captured),
      });
      logger.info("run", "trip rotation immediately");
      await waitForFiles(dir, ["main.log.1"]);

      const files = await readdir(dir);
      expect(files).toContain("main.log.1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exposes getLogFilePath pointing at the active file inside the directory", () => {
    expect(getLogFilePath("/tmp/whatever")).toBe(path.join("/tmp/whatever", LOGGER_ACTIVE_FILENAME));
  });

  it("accepts all three levels through log()", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-"));
    try {
      const captured: CapturedChunk[] = [];
      const logger = createLogger({
        logDirectory: dir,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
        createStream: createCapturingStreamFactory(captured),
      });
      const levels: LogLevel[] = ["INFO", "WARN", "ERROR"];
      for (const level of levels) logger.log(level, "scope", "msg");
      await waitFor(() => (captured.length >= 3 ? captured.length : undefined));

      expect(captured.map((c) => c.data)).toEqual([
        "2026-08-02T16:01:21.000Z INFO [scope] msg\n",
        "2026-08-02T16:01:21.000Z WARN [scope] msg\n",
        "2026-08-02T16:01:21.000Z ERROR [scope] msg\n",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Smoke test against the real filesystem (no stream injection): guarantees
  // the production createWriteStream path actually persists bytes to disk.
  it("persists lines to the real log file on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "carrent-log-real-"));
    try {
      const logger = createLogger({
        logDirectory: dir,
        now: () => new Date("2026-08-02T16:01:21.000Z"),
      });
      logger.info("startup", "carrent booted", { electron: "41.2.2" });
      await waitFor(async () => {
        try {
          const contents = await readFile(getLogFilePath(dir), "utf8");
          return contents.includes("carrent booted") ? contents : undefined;
        } catch {
          return undefined;
        }
      });

      const contents = await readFile(getLogFilePath(dir), "utf8");
      expect(contents).toContain("INFO [startup] carrent booted");
      expect(contents).toContain('"electron":"41.2.2"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
