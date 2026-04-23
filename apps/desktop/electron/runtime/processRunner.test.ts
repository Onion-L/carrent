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

  it("marks timed out commands explicitly", async () => {
    const runner = createProcessRunner();

    const result = await runner.run(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
      timeoutMs: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(null);
    expect(result.errorCode).toBeUndefined();
    expect(result.signal).toBe("SIGTERM");
    expect(result.timedOut).toBe(true);
  });
});
