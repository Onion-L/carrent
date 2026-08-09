import {
  SqliteError,
  toSqliteError,
  type MigrationContext,
  type SqliteChangeResult,
  type SqliteClient,
  type SqliteParameters,
  type SqliteStatement,
  type SqliteValue,
} from "./sqliteClient";

/**
 * Low-level primitives a runtime adapter exposes from its driver.
 *
 * Both `bun:sqlite` and `node:sqlite` expose a `Database`, a `prepare` that
 * returns `run/get/all`, and a synchronous `exec`/`close`. They differ only in
 * the run-result shape (`bigint` vs `number` for `lastInsertRowid`) and in
 * which module path resolves. Each adapter implements this tiny surface; the
 * shared {@link createSqliteClient} layers the contract on top so repositories
 * never see the driver shape.
 */
export interface SqliteDriverConnection {
  readonly path: string;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: readonly unknown[]): {
      lastInsertRowid: number | bigint;
      changes: number | bigint;
    };
    get<T = unknown>(...params: readonly unknown[]): T | null;
    all<T = unknown>(...params: readonly unknown[]): T[];
  };
  close(): void;
}

const REPEATING_WHITESPACE = /\s+/g;

function compactWhitespace(sql: string): string {
  return sql.trim().replace(REPEATING_WHITESPACE, " ");
}

/**
 * Normalize a driver run result to the contract shape. Both drivers may return
 * `lastInsertRowid` and `changes` as `bigint`; we coerce to `number` because
 * Carrent's integer primary keys are application-generated identifiers that
 * always fit in a safe integer.
 */
function normalizeChangeResult(raw: {
  lastInsertRowid: number | bigint;
  changes: number | bigint;
}): SqliteChangeResult {
  const lastInsertRowid =
    typeof raw.lastInsertRowid === "bigint" ? Number(raw.lastInsertRowid) : raw.lastInsertRowid;
  const changes = typeof raw.changes === "bigint" ? Number(raw.changes) : raw.changes;
  return { lastInsertRowid: lastInsertRowid ?? null, changes: changes ?? 0 };
}

/**
 * Reject a transaction callback result that crossed an `await` boundary.
 *
 * The transaction is synchronous: `BEGIN` … `work()` … `COMMIT` run on one
 * stack. If `work` is `async`, it returns a Promise that resolves *after*
 * `COMMIT` has already executed, so a half-applied transaction commits and any
 * async rejection escapes rollback. Both drivers keep the transaction on the
 * current synchronous stack, so this guard makes the contract's "callbacks are
 * synchronous and must not cross an `await`" rule enforceable at runtime.
 */
function rejectAsyncTransactionResult(result: unknown): void {
  if (
    result !== null &&
    typeof result === "object" &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    throw new SqliteError(
      "error",
      "SQLite transaction callback returned a Promise; transactions must stay synchronous and not cross an await boundary.",
    );
  }
}

/**
 * Build the {@link SqliteClient} contract over a runtime driver connection.
 *
 * This shared layer owns:
 * - a prepared-statement cache keyed by the compacted SQL text, so the hot
 *   command path does not reparse SQL on every write;
 * - the `run`/`get`/`all`/`pragma` conveniences;
 * - an immediate, exclusive `transaction` that runs a synchronous callback and
 *   rolls back on any throw, re-raising it as a {@link SqliteError}.
 *
 * The transaction implementation uses `BEGIN IMMEDIATE` so writes take the
 * reserved lock up front. The App State Store serializes all operations on one
 * queue, so there is never a second writer contending for the lock; `IMMEDIATE`
 * still keeps reads from interleaving with a half-applied transaction.
 */
export function createSqliteClient(connection: SqliteDriverConnection): SqliteClient {
  const statements = new Map<string, SqliteStatement>();

  function prepare(sql: string): SqliteStatement {
    const key = compactWhitespace(sql);
    const cached = statements.get(key);
    if (cached) return cached;
    const driverStatement = connection.prepare(sql);
    // Defined as standalone generic functions so TypeScript accepts the `<T>`
    // return contract on `get`/`all` (both drivers key columns by name; callers
    // narrow with a call-site type argument). Assembling the same signatures as
    // an object literal would not type-check, because the literal cannot prove a
    // `Record<string, SqliteValue>` return satisfies an arbitrary `T`.
    function run(...params: SqliteParameters): SqliteChangeResult {
      try {
        return normalizeChangeResult(driverStatement.run(...params));
      } catch (error) {
        throw toSqliteError(error);
      }
    }
    function get<T = Record<string, SqliteValue>>(...params: SqliteParameters): T | null {
      try {
        return (driverStatement.get(...params) ?? null) as T | null;
      } catch (error) {
        throw toSqliteError(error);
      }
    }
    function all<T = Record<string, SqliteValue>>(...params: SqliteParameters): T[] {
      try {
        return driverStatement.all(...params) as T[];
      } catch (error) {
        throw toSqliteError(error);
      }
    }
    const statement: SqliteStatement = { run, get, all };
    statements.set(key, statement);
    return statement;
  }

  let transactionDepth = 0;
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new SqliteError("error", "SQLite connection is closed.");
  }

  const client: SqliteClient = {
    get path() {
      return connection.path;
    },

    prepare,

    exec(sql) {
      assertOpen();
      try {
        connection.exec(sql);
      } catch (error) {
        throw toSqliteError(error);
      }
    },

    run(sql, ...params) {
      assertOpen();
      return prepare(sql).run(...params);
    },

    get(sql, ...params) {
      assertOpen();
      return prepare(sql).get(...params);
    },

    all(sql, ...params) {
      assertOpen();
      return prepare(sql).all(...params);
    },

    pragma(name, value) {
      assertOpen();
      const escaped = name.replace(/"/gu, '""');
      const sql =
        value === undefined
          ? `PRAGMA ${escaped}`
          : `PRAGMA ${escaped} = ${typeof value === "number" ? value : `'${String(value).replace(/'/gu, "''")}'`}`;
      try {
        const row = connection.prepare(sql).get() as Record<string, SqliteValue> | null;
        if (!row) return null;
        const first = Object.values(row)[0];
        return (first ?? null) as SqliteValue;
      } catch (error) {
        throw toSqliteError(error);
      }
    },

    transaction(work) {
      assertOpen();
      if (transactionDepth > 0) {
        // Nested call inside an already-open transaction: run inline so
        // repository helpers do not need to know whether their caller already
        // opened one. The outer transaction still owns commit/rollback.
        transactionDepth += 1;
        try {
          return work();
        } finally {
          transactionDepth -= 1;
        }
      }
      transactionDepth += 1;
      try {
        connection.exec("BEGIN IMMEDIATE");
      } catch (error) {
        transactionDepth -= 1;
        throw toSqliteError(error);
      }
      try {
        const result = work();
        // The transaction is synchronous: an `async` callback would return a
        // Promise here, COMMIT before it settles, and escape rollback for any
        // async rejection. Reject a thenable return loudly instead of letting a
        // caller accidentally commit a half-applied transaction.
        rejectAsyncTransactionResult(result);
        connection.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          connection.exec("ROLLBACK");
        } catch (rollbackError) {
          // A rollback failure is itself a SQLite error; surface it as cause on
          // the original error so the caller sees both. Rollback rarely fails
          // because BEGIN IMMEDIATE held the write lock throughout.
          throw toSqliteError(
            new AggregateError([error, rollbackError], "Transaction rollback failed."),
          );
        }
        throw error instanceof SqliteError ? error : toSqliteError(error);
      } finally {
        transactionDepth -= 1;
      }
    },

    close() {
      if (closed) return;
      closed = true;
      statements.clear();
      try {
        connection.close();
      } catch (error) {
        throw toSqliteError(error);
      }
    },
  };

  return client;
}

/**
 * The slice of {@link SqliteClient} handed to a migration body. Migrations run
 * inside the runner's transaction, so this exposes everything except the
 * `transaction` method itself.
 */
export function migrationContextOf(client: SqliteClient): MigrationContext {
  return {
    prepare: (sql) => client.prepare(sql),
    exec: (sql) => client.exec(sql),
    run: (sql, ...params) => client.run(sql, ...params),
    get: (sql, ...params) => client.get(sql, ...params),
    all: (sql, ...params) => client.all(sql, ...params),
  };
}
