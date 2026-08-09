/**
 * SQLite client contract.
 *
 * Carrent persists App State to SQLite in two execution environments that each
 * ship their own built-in SQLite driver: Electron/Node exposes `node:sqlite`
 * and Bun exposes `bun:sqlite`. Neither runtime can resolve the other's
 * built-in module, so Carrent owns this small contract and provides a runtime
 * adapter for each. Repositories, migrations, and the App State Store depend
 * only on this contract and never on a specific driver's return shape.
 *
 * The contract is deliberately synchronous. Both drivers execute prepared
 * statements synchronously, and SQLite serializes writes per connection. The
 * App State Store wraps this in an asynchronous, serialized queue so it stays
 * compatible with the existing command and shutdown lifecycles.
 */

/**
 * A single SQLite value, restricted to what both drivers accept as a bound
 * parameter. `Uint8Array` is accepted for completeness but App State only
 * persists text and numbers.
 */
export type SqliteValue = null | number | bigint | string | Uint8Array;

/** Bindable parameters accepted by prepared statements. */
export type SqliteParameters = readonly SqliteValue[];

/**
 * Result of a statement that changes rows (`INSERT`/`UPDATE`/`DELETE`).
 * `lastInsertRowid` is normalized to a `number` so callers never see a driver
 * `bigint` difference.
 */
export type SqliteChangeResult = {
  lastInsertRowid: number | null;
  changes: number;
};

/**
 * A prepared statement. Bound parameters are always passed positionally and
 * SQL values are always bound as parameters, never interpolated.
 */
export interface SqliteStatement {
  /**
   * Execute the statement and return the row-change summary. Used for writes
   * (`INSERT`/`UPDATE`/`DELETE`) and for statements that do not return rows.
   */
  run(...params: SqliteParameters): SqliteChangeResult;
  /**
   * Execute the statement and return the first matching row, or `null` when
   * there is no match. Columns are returned by name as a plain object.
   */
  get<T = Record<string, SqliteValue>>(...params: SqliteParameters): T | null;
  /**
   * Execute the statement and return every matching row. Columns are returned
   * by name as plain objects, in query order.
   */
  all<T = Record<string, SqliteValue>>(...params: SqliteParameters): T[];
}

/**
 * A SQLite connection. The lifecycle, PRAGMA control, bound execution,
 * single-row and multi-row reads, and transaction control that the App State
 * Store and repositories depend on all live here.
 */
export interface SqliteClient {
  /** The on-disk path the connection was opened with (`":memory:"` included). */
  readonly path: string;

  /**
   * Compile a SQL statement once. Statements are cached for the connection
   * lifetime so repeated execution does not reparse SQL.
   */
  prepare(sql: string): SqliteStatement;

  /**
   * Execute SQL that does not return rows (DDL, `PRAGMA`, multi-statement
   * scripts). Throws on any driver error.
   */
  exec(sql: string): void;

  /**
   * Run a statement with bound parameters and return the row-change summary.
   * Convenience equivalent to `prepare(sql).run(...params)`.
   */
  run(sql: string, ...params: SqliteParameters): SqliteChangeResult;

  /**
   * Run a statement with bound parameters and return the first row or `null`.
   * Convenience equivalent to `prepare(sql).get(...params)`.
   */
  get<T = Record<string, SqliteValue>>(sql: string, ...params: SqliteParameters): T | null;

  /**
   * Run a statement with bound parameters and return all matching rows.
   * Convenience equivalent to `prepare(sql).all(...params)`.
   */
  all<T = Record<string, SqliteValue>>(sql: string, ...params: SqliteParameters): T[];

  /**
   * Apply a connection PRAGMA and read back its result. Returns the scalar
   * value SQLite reports for the PRAGMA, or `null` when SQLite returns no row.
   *
   * `foreign_keys`, `journal_mode`, `synchronous`, and `busy_timeout` are the
   * PRAGMAs the App State Store sets on startup; callers use this to verify
   * the applied value rather than trusting the call to succeed silently.
   */
  pragma(name: string, value?: string | number): SqliteValue;

  /**
   * Run `work` inside an immediate, exclusive transaction.
   *
   * The callback is synchronous and must not cross an `await` boundary: both
   * drivers keep the transaction on the current synchronous stack, and letting
   * the event loop turn mid-transaction would interleave other writes on the
   * shared serialized queue. If `work` throws, the transaction rolls back and
   * the error re-throws as a {@link SqliteError}; otherwise it commits.
   *
   * Nested `transaction` calls reuse the already-open transaction (savepoints
   * are not exposed) so repository methods never create competing transactions.
   */
  transaction<T>(work: () => T): T;

  /**
   * Close the connection and release the file handle. After `close`, any
   * further use throws. Safe to call multiple times.
   */
  close(): void;
}

/**
 * A normalized SQLite error. Both drivers throw constraint, uniqueness, and
 * foreign-key failures as plain `Error`s with different shapes — Bun attaches
 * a SQLite result code (e.g. `SQLITE_CONSTRAINT_UNIQUE`) to `code`, while
 * `node:sqlite` reports `code: "ERR_SQLITE_ERROR"` with only the message text.
 * The adapter maps both onto this shape so repositories and the migration
 * runner can branch on `result` without driver knowledge.
 */
export type SqliteErrorResult =
  /** A `UNIQUE` constraint failed. */
  | "unique"
  /** A `NOT NULL` constraint failed. */
  | "not-null"
  /** A `FOREIGN KEY` constraint failed. */
  | "foreign-key"
  /** A `CHECK` constraint failed. */
  | "check"
  /** Any other constraint failure (e.g. partial unique without detail). */
  | "constraint"
  /** Any other SQLite failure. */
  | "error";

export class SqliteError extends Error {
  readonly result: SqliteErrorResult;
  readonly cause: unknown;
  constructor(result: SqliteErrorResult, message: string, cause?: unknown) {
    super(message);
    this.name = "SqliteError";
    this.result = result;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Map a raw driver error onto a {@link SqliteError}. Recognizes Bun's
 * SQLite result codes and the SQLite constraint message prefixes that both
 * drivers emit, so the classification is stable across runtimes.
 */
export function toSqliteError(error: unknown): SqliteError {
  if (error instanceof SqliteError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error as { message?: unknown } | null)?.message;
  const text = typeof message === "string" ? message : String(error);
  if (typeof code === "string") {
    if (code === "SQLITE_CONSTRAINT_UNIQUE") return new SqliteError("unique", text, error);
    if (code === "SQLITE_CONSTRAINT_NOTNULL") return new SqliteError("not-null", text, error);
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") return new SqliteError("foreign-key", text, error);
    if (code === "SQLITE_CONSTRAINT_CHECK") return new SqliteError("check", text, error);
    if (code.startsWith("SQLITE_CONSTRAINT")) return new SqliteError("constraint", text, error);
  }
  // node:sqlite reports constraint failures only as a message (no SQLite code),
  // so classify by the message prefix both drivers emit.
  if (text.startsWith("UNIQUE constraint failed")) return new SqliteError("unique", text, error);
  if (text.startsWith("NOT NULL constraint failed"))
    return new SqliteError("not-null", text, error);
  if (text.startsWith("FOREIGN KEY constraint failed"))
    return new SqliteError("foreign-key", text, error);
  if (text.startsWith("CHECK constraint failed")) return new SqliteError("check", text, error);
  return new SqliteError("error", text, error);
}

/**
 * Options for opening a connection. `readOnly` opens an existing database
 * without write access; otherwise the file (and parent directory) is created.
 */
export interface OpenSqliteClientOptions {
  readOnly?: boolean;
}

/**
 * A runtime adapter. `open` constructs a driver connection and returns it as a
 * {@link SqliteClient}; each adapter lives in its own module so that one
 * runtime never has to resolve the other's built-in SQLite module.
 */
export interface SqliteDriver {
  open(path: string, options?: OpenSqliteClientOptions): SqliteClient;
}

/**
 * A connection-scoped transaction context handed to migration bodies. It is a
 * slice of {@link SqliteClient} without `transaction` itself, so a migration
 * cannot start a nested transaction: the runner owns the enclosing transaction
 * and commits the DDL, data changes, and `schema_migrations` row together.
 */
export type MigrationContext = Pick<SqliteClient, "prepare" | "exec" | "run" | "get" | "all">;
