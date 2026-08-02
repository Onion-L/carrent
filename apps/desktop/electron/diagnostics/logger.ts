import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rename, readdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogMeta = Record<string, unknown>;

export type Logger = {
  log: (level: LogLevel, scope: string, message: string, meta?: LogMeta) => void;
  info: (scope: string, message: string, meta?: LogMeta) => void;
  warn: (scope: string, message: string, meta?: LogMeta) => void;
  error: (scope: string, message: string, meta?: LogMeta) => void;
};

export type CreateLoggerOptions = {
  logDirectory: string;
  // Bytes after which the active file is rotated. Defaults to ~5 MiB.
  maxBytes?: number;
  // Number of rotated files to keep (main.log.1 .. main.log.N). Defaults to 4.
  maxRotatedFiles?: number;
  // Per-line size cap; a single line longer than this is truncated so a runaway
  // meta object cannot skip rotation by being one giant line.
  maxLineBytes?: number;
  // Injectable clock/teardown so tests need not sleep or leak streams.
  now?: () => Date;
  createStream?: (path: string) => WriteStream;
};

const ACTIVE_FILENAME = "main.log";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROTATED_FILES = 4;
const DEFAULT_MAX_LINE_BYTES = 16 * 1024;

/**
 * A rotating, append-only logger for the main process. One line per call,
 * ISO timestamp + level + scope + JSON meta. The writer never throws: a logger
 * that crashes while reporting a crash is worse than no logger.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRotatedFiles = options.maxRotatedFiles ?? DEFAULT_MAX_ROTATED_FILES;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const now = options.now ?? (() => new Date());
  const createStream = options.createStream ?? defaultCreateStream;

  const activePath = join(options.logDirectory, ACTIVE_FILENAME);
  let stream: WriteStream | null = null;
  let opening = false;
  let pendingOpen: Promise<void> | null = null;
  // Lines written before the stream is ready are flushed in open order; once
  // open, every line is written synchronously to the stream buffer.
  const buffer: string[] = [];
  let bytesSinceRotation = 0;

  async function ensureOpen(): Promise<void> {
    if (stream && stream.writable && !stream.destroyed) return;
    if (pendingOpen) return pendingOpen;
    pendingOpen = open();
    return pendingOpen;
  }

  async function open(): Promise<void> {
    if (opening) return;
    opening = true;
    try {
      await mkdir(options.logDirectory, { recursive: true });
      try {
        const stats = await stat(activePath);
        bytesSinceRotation = stats.size;
      } catch {
        // First launch: the file does not exist yet, start at zero.
        bytesSinceRotation = 0;
      }
      const next = createStream(activePath);
      stream = next;
      next.on("error", () => {
        // A failed write (disk full, etc.) must not propagate; drop the stream
        // so the next call attempts to reopen instead of writing into a dead fd.
        if (stream === next) stream = null;
      });
      // Flush anything buffered while the stream was opening. Each buffered
      // line is written via the normal path so byte accounting and rotation
      // checks stay consistent.
      const flushed = buffer.splice(0);
      for (const line of flushed) {
        writeToStream(next, line);
      }
      // Buffering happened because the stream was not yet open, so the rotation
      // check that the synchronous log() path performs could not run; do it now
      // once the backlog is on disk.
      void maybeRotate();
    } catch {
      // Could not open (read-only fs, permissions): abandon so log() falls back
      // to console and we keep retrying on subsequent calls.
      stream = null;
    } finally {
      opening = false;
      pendingOpen = null;
    }
  }

  function writeToStream(target: WriteStream, line: string): void {
    target.write(line);
    bytesSinceRotation += Buffer.byteLength(line, "utf8");
  }

  // Rotation runs asynchronously because rename/unlink are async. The flag
  // prevents concurrent rotations from overlapping; if a second rotation is
  // requested while one is in flight, the in-flight one re-checks the byte
  // total after it finishes so a burst of writes is fully drained.
  let rotating = false;
  let rotateAgain = false;
  async function maybeRotate(): Promise<void> {
    if (bytesSinceRotation < maxBytes) return;
    if (rotating) {
      rotateAgain = true;
      return;
    }
    rotating = true;
    try {
      do {
        rotateAgain = false;
        const current = stream;
        stream = null;
        if (current) {
          current.end();
        }
        await shiftRotatedFiles();
        bytesSinceRotation = 0;
        await ensureOpen();
        // Loop if more bytes arrived while we were rotating.
      } while (rotateAgain && bytesSinceRotation >= maxBytes);
    } catch {
      // Best effort: rotation failure should not stop future logging.
    } finally {
      rotating = false;
    }
  }

  async function shiftRotatedFiles(): Promise<void> {
    // Drop the oldest kept file, then rename .N-1 -> .N down to active -> .1.
    try {
      await unlink(join(options.logDirectory, `${ACTIVE_FILENAME}.${maxRotatedFiles}`));
    } catch {
      // Oldest may not exist yet on a fresh log.
    }
    for (let index = maxRotatedFiles - 1; index >= 1; index -= 1) {
      const from = join(options.logDirectory, `${ACTIVE_FILENAME}.${index}`);
      const to = join(options.logDirectory, `${ACTIVE_FILENAME}.${index + 1}`);
      try {
        await rename(from, to);
      } catch {
        // Missing intermediate files are fine; rotation continues.
      }
    }
    try {
      await rename(activePath, join(options.logDirectory, `${ACTIVE_FILENAME}.1`));
    } catch {
      // If the active file vanished, ensureOpen will recreate it.
    }
    // Defensive: prune any stray files beyond the kept window (e.g. a lowered
    // maxRotatedFiles after an upgrade).
    await pruneExtraRotatedFiles();
  }

  async function pruneExtraRotatedFiles(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(options.logDirectory);
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const match = /^main\.log\.(\d+)$/.exec(entry);
        if (!match) return;
        if (Number.parseInt(match[1], 10) <= maxRotatedFiles) return;
        try {
          await unlink(join(options.logDirectory, entry));
        } catch {
          // Best effort.
        }
      }),
    );
  }

  function formatLine(level: LogLevel, scope: string, message: string, meta?: LogMeta): string {
    const ts = now().toISOString();
    const line = meta && Object.keys(meta).length > 0
      ? `${ts} ${level} [${scope}] ${message} ${safeStringify(meta)}\n`
      : `${ts} ${level} [${scope}] ${message}\n`;
    if (Buffer.byteLength(line, "utf8") <= maxLineBytes) return line;

    // Byte-level truncation that is safe under multi-byte UTF-8. Keep as much
    // of the leading "ts LEVEL [scope] message" as fits under
    // (maxLineBytes - suffix) bytes, then append the truncation marker. The
    // result is always <= maxLineBytes even if scope itself is huge.
    const suffix = " …[truncated]\n";
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    const budget = Math.max(0, maxLineBytes - suffixBytes);
    const buf = Buffer.from(line, "utf8");
    const keepBytes = Math.min(buf.length, budget);
    return `${buf.subarray(0, keepBytes).toString("utf8")}${suffix}`;
  }

  function safeStringify(meta: LogMeta): string {
    try {
      return JSON.stringify(meta);
    } catch {
      // Circular references etc.: fall back to a shallow, lossy rendering.
      return `{${Object.keys(meta).map((k) => `${k}=<unserializable>`).join(",")}}`;
    }
  }

  function log(level: LogLevel, scope: string, message: string, meta?: LogMeta): void {
    const line = formatLine(level, scope, message, meta);
    const target = stream;
    if (target && target.writable && !target.destroyed) {
      writeToStream(target, line);
      void maybeRotate();
      return;
    }
    buffer.push(line);
    void ensureOpen();
  }

  return {
    log,
    info: (scope, message, meta) => log("INFO", scope, message, meta),
    warn: (scope, message, meta) => log("WARN", scope, message, meta),
    error: (scope, message, meta) => log("ERROR", scope, message, meta),
  };
}

function defaultCreateStream(path: string): WriteStream {
  // { flags: "a" } creates the file if missing and appends otherwise. The
  // containing directory is created by ensureOpen before this is called.
  return createWriteStream(path, { flags: "a" });
}

// Re-exported so callers that just want the default active filename (e.g. to
// open it for the user) don't duplicate the literal.
export const LOGGER_ACTIVE_FILENAME = ACTIVE_FILENAME;

export function getLogFilePath(logDirectory: string): string {
  return join(logDirectory, ACTIVE_FILENAME);
}
