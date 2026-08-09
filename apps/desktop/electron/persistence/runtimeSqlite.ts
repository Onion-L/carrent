import type { OpenSqliteClientOptions, SqliteClient, SqliteDriver } from "./sqliteClient";

/**
 * Whether the current process is a Bun runtime. Bun sets
 * `process.versions.bun`; Node and Electron leave it `undefined`.
 */
export function isBunRuntime(): boolean {
  return typeof (process as { versions?: { bun?: unknown } }).versions?.bun !== "undefined";
}

/**
 * Lazily resolve the SQLite driver for the current runtime.
 *
 * The two drivers live in separate modules, each importing its own built-in
 * (`bun:sqlite` or `node:sqlite`). We load them with dynamic `import()` gated
 * on {@link isBunRuntime} so that only the matching built-in is ever resolved:
 * Bun never imports `node:sqlite` (which it cannot resolve) and Node/Electron
 * never imports `bun:sqlite` (which it cannot resolve).
 *
 * The loaded driver is cached for the process lifetime. The App State Store
 * holds the single application connection, so a second `loadDriver()` call is
 * only expected in tests and from the runtime factory.
 */
export async function loadSqliteDriver(): Promise<SqliteDriver> {
  if (isBunRuntime()) {
    const module = await import("./bunSqliteDriver");
    return module.bunSqliteDriver;
  }
  const module = await import("./nodeSqliteDriver");
  return module.nodeSqliteDriver;
}

let cachedDriverPromise: Promise<SqliteDriver> | null = null;

/**
 * Resolve the cached runtime SQLite driver, loading it once per process.
 */
export async function getSqliteDriver(): Promise<SqliteDriver> {
  if (!cachedDriverPromise) cachedDriverPromise = loadSqliteDriver();
  return cachedDriverPromise;
}

/**
 * Open a {@link SqliteClient} over the runtime-selected driver.
 *
 * The App State Store calls this (via {@link getSqliteDriver}) so the
 * connection always comes from whichever built-in the current runtime can
 * resolve. Repositories and other modules that need a connection should obtain
 * it from the store rather than opening their own.
 */
export async function openSqliteClient(
  path: string,
  options?: OpenSqliteClientOptions,
): Promise<SqliteClient> {
  const driver = await getSqliteDriver();
  return driver.open(path, options);
}
