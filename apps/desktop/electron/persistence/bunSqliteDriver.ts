import { Database } from "bun:sqlite";
import { createSqliteClient, type SqliteDriverConnection } from "./sqliteClientAdapter";
import type { OpenSqliteClientOptions, SqliteClient, SqliteDriver } from "./sqliteClient";

/**
 * Bun SQLite adapter.
 *
 * Bun resolves the `bun:sqlite` built-in but cannot resolve `node:sqlite`, so
 * this adapter is the only module that imports `bun:sqlite`. It is loaded
 * dynamically by {@link ./runtimeSqlite.ts} only when `process.versions.bun` is
 * set, so Electron/Node never has to resolve the Bun built-in.
 */
function openConnection(path: string, options: OpenSqliteClientOptions): SqliteDriverConnection {
  // Bun's `Database` requires explicit `readwrite`/`readonly` flags whenever an
  // options object is passed, so we omit options entirely for the default
  // read/write/create case and only pass `{ readonly: true }` when requested.
  const database =
    options.readOnly === true ? new Database(path, { readonly: true }) : new Database(path);
  return {
    get path() {
      return path;
    },
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
    close: () => database.close(),
  };
}

export const bunSqliteDriver: SqliteDriver = {
  open(path, options) {
    const connection = openConnection(path, options ?? {});
    return createSqliteClient(connection);
  },
};

/**
 * Open a {@link SqliteClient} backed by `bun:sqlite`. Exported for the runtime
 * factory and for tests that want to address the Bun adapter directly.
 */
export function openBunSqliteClient(path: string, options?: OpenSqliteClientOptions): SqliteClient {
  return bunSqliteDriver.open(path, options);
}
