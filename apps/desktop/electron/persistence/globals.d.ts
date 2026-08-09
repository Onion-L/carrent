/**
 * Minimal ambient declaration for the `bun:sqlite` built-in module.
 *
 * The desktop typecheck project only resolves `@types/node`, so the Bun
 * built-in has no type declarations under `bun run typecheck`. The Bun adapter
 * imports this module behind a dynamic, runtime-selected load, and we declare
 * only the small surface it depends on. Bun provides the real module at runtime
 * in its test workflow.
 */
declare module "bun:sqlite" {
  export type SqliteChangeResult = {
    lastInsertRowid: number | bigint;
    changes: number;
  };

  export interface BunSqliteStatement {
    run(...params: unknown[]): SqliteChangeResult;
    get<T = unknown>(...params: unknown[]): T | null;
    all<T = unknown>(...params: unknown[]): T[];
  }

  export class Database {
    constructor(path: string, options?: { readonly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): BunSqliteStatement;
    close(): void;
  }
}
