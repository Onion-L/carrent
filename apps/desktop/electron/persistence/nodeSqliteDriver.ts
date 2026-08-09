import { DatabaseSync } from "node:sqlite";
import { createSqliteClient, type SqliteDriverConnection } from "./sqliteClientAdapter";
import type { OpenSqliteClientOptions, SqliteClient, SqliteDriver } from "./sqliteClient";

/**
 * Node/Electron SQLite adapter.
 *
 * Electron and supported Node runtimes resolve the `node:sqlite` built-in but
 * cannot resolve `bun:sqlite`. This adapter is the only module that imports
 * `node:sqlite` and is loaded dynamically by {@link ./runtimeSqlite.ts} only
 * when `process.versions.bun` is absent, so Bun never has to resolve the Node
 * built-in. Production therefore depends only on Electron's built-in SQLite —
 * no third-party native addon is introduced.
 */
function openConnection(path: string, options: OpenSqliteClientOptions): SqliteDriverConnection {
  const database = new DatabaseSync(path, { readOnly: options.readOnly === true });
  return {
    get path() {
      return path;
    },
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
    close: () => database.close(),
  };
}

export const nodeSqliteDriver: SqliteDriver = {
  open(path, options) {
    const connection = openConnection(path, options ?? {});
    return createSqliteClient(connection);
  },
};

/**
 * Open a {@link SqliteClient} backed by `node:sqlite`. Exported for the runtime
 * factory and for the Node/Electron smoke suite, which exercises the production
 * adapter directly.
 */
export function openNodeSqliteClient(
  path: string,
  options?: OpenSqliteClientOptions,
): SqliteClient {
  return nodeSqliteDriver.open(path, options);
}
