import { describe, expect, it } from "bun:test";

import { createProcessRunner } from "./processRunner";

describe("createProcessRunner", () => {
  it("maps spawn failures into structured result fields", async () => {
    const runner = createProcessRunner();

    const result = await runner.run("command-that-does-not-exist-carrent", []);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(null);
    expect(result.errorCode).toBe("ENOENT");
    expect(result.signal).toBe(null);
    expect(result.timedOut).toBe(false);
  });
});
