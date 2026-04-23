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

  it("closes stdin so non-interactive CLIs do not wait for EOF", async () => {
    const runner = createProcessRunner();

    const result = await runner.run(
      process.execPath,
      [
        "-e",
        "process.stdin.resume(); process.stdin.on('end', () => console.log('stdin closed'));",
      ],
      { timeoutMs: 1000 },
    );

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("stdin closed");
    expect(result.timedOut).toBe(false);
  });
});
