import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { initializeSqliteAppState } from "./sqliteAppStateImport";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";

describe("initializeSqliteAppState", () => {
  it("imports JSON App State and then uses SQLite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-import-"));
    const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    const snapshot = createEmptyAppStateSnapshot();
    try {
      await writeFile(join(dir, "app-state.json"), JSON.stringify(snapshot), "utf-8");
      await store.open();

      const imported = await initializeSqliteAppState(store, dir, {
        now: () => "2026-08-20T08:00:00.000Z",
      });
      expect(imported).toMatchObject({ status: "ready", source: "json", snapshot });

      const reopened = await initializeSqliteAppState(store, dir, {
        now: () => "2026-08-20T08:01:00.000Z",
      });
      expect(reopened).toMatchObject({ status: "ready", source: "sqlite", snapshot });
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
