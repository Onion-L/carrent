import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { installBrowserOpener } from "./browserOpener";

describe("installBrowserOpener", () => {
  it("creates an executable launcher backed by the bundled runtime", () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      const path = installBrowserOpener(directory, process.execPath);

      expect(statSync(path).mode & 0o111).not.toBe(0);
      expect(readFileSync(path, "utf8")).toContain("ELECTRON_RUN_AS_NODE=1");

      const result = spawnSync(path, [], { encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
