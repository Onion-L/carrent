import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PtyAdapter, PtyProcess } from "../terminal/terminalSessionManager";
import {
  AcpTerminalSpawnError,
  createAcpTerminalManager,
  resolveAcpTerminalShell,
} from "./acpTerminalManager";

class FakePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ columns: number; rows: number }> = [];
  killed = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize(columns: number, rows: number) {
    this.resizes.push({ columns, rows });
  }

  kill() {
    this.killed = true;
  }

  emitData(data: string) {
    this.dataListeners.forEach((listener) => listener(data));
  }

  emitExit(exitCode: number, signal?: number) {
    this.exitListeners.forEach((listener) => listener({ exitCode, signal }));
  }
}

function createHarness(overrides: Partial<Parameters<typeof createAcpTerminalManager>[0]> = {}) {
  const spawns: Array<{
    file: string;
    args: string[];
    options: Parameters<PtyAdapter["spawn"]>[2];
    process: FakePtyProcess;
  }> = [];
  const pty: PtyAdapter = {
    spawn(file, args, options) {
      const process = new FakePtyProcess();
      spawns.push({ file, args, options, process });
      return process;
    },
  };
  let nextId = 0;
  const manager = createAcpTerminalManager({
    pty,
    cwd: "/workspace",
    env: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
    platform: "darwin",
    arch: "arm64",
    checkExecutable: () => true,
    createId: () => `acp-terminal-${++nextId}`,
    ...overrides,
  });
  return { manager, spawns, pty };
}

describe("createAcpTerminalManager", () => {
  it("runs current Kimi command and args with the requested environment", async () => {
    const { manager, spawns } = createHarness();

    const created = await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "pwd"],
      cwd: "/workspace/subdir",
      env: [
        { name: "TERM", value: "dumb" },
        { name: "NO_COLOR", value: "1" },
      ],
      outputByteLimit: 1024,
    });

    expect(created).toEqual({ terminalId: "acp-terminal-1" });
    expect(spawns[0]).toMatchObject({
      file: "/bin/bash",
      args: ["-c", "pwd"],
      options: {
        cwd: "/workspace/subdir",
        cols: 80,
        rows: 24,
        name: "dumb",
        env: { PATH: "/usr/bin", SHELL: "/bin/zsh", TERM: "dumb", NO_COLOR: "1" },
      },
    });

    spawns[0]!.process.emitData("/workspace/subdir\r\n");
    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "/workspace/subdir\r\n",
      truncated: false,
    });

    const waiting = manager.waitForExit({ sessionId: "session-1", ...created });
    spawns[0]!.process.emitExit(0);
    expect(await waiting).toEqual({ exitCode: 0 });
    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "/workspace/subdir\r\n",
      truncated: false,
      exitStatus: { exitCode: 0 },
    });
  });

  it("runs legacy Kimi command strings through the user's shell", async () => {
    const { manager, spawns } = createHarness();

    await manager.create({ sessionId: "session-1", command: "ls -la" });

    expect(spawns[0]).toMatchObject({
      file: "/bin/zsh",
      args: ["-lc", "ls -la"],
      options: { cwd: "/workspace" },
    });
  });

  it("truncates retained output from the beginning on a UTF-8 boundary", async () => {
    const { manager, spawns } = createHarness();
    const created = await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "printf output"],
      outputByteLimit: 5,
    });

    spawns[0]!.process.emitData("ab😀cd");

    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "cd",
      truncated: true,
    });
  });

  it("kills without releasing and releases terminal resources separately", async () => {
    const { manager, spawns } = createHarness();
    const created = await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "sleep 60"],
    });

    expect(await manager.kill({ sessionId: "session-1", ...created })).toEqual({});
    expect(spawns[0]!.process.killed).toBe(true);
    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "",
      truncated: false,
    });

    expect(await manager.release({ sessionId: "session-1", ...created })).toEqual({});
    let rejection: unknown;
    try {
      await manager.output({ sessionId: "session-1", ...created });
    } catch (error) {
      rejection = error;
    }
    expect(rejection instanceof Error).toBe(true);
    expect((rejection as Error).message).toContain("ACP terminal is unavailable");
  });

  it("kills and releases every live terminal when the Run closes", async () => {
    const { manager, spawns } = createHarness();
    await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "sleep 60"],
    });
    await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "sleep 60"],
    });

    await manager.close();

    expect(spawns.map(({ process }) => process.killed)).toEqual([true, true]);
  });

  it("falls back to the default shell when env.SHELL is unusable", async () => {
    const { manager, spawns } = createHarness({
      env: { PATH: "/usr/bin", SHELL: "/definitely/not/a/shell" },
      checkExecutable: (path) => path !== "/definitely/not/a/shell",
    });

    await manager.create({ sessionId: "session-1", command: "ls -la" });

    expect(spawns[0]).toMatchObject({ file: "/bin/zsh", args: ["-lc", "ls -la"] });
  });

  it("falls back to the default shell when env.SHELL is unset", async () => {
    const { manager, spawns } = createHarness({
      env: { PATH: "/usr/bin" },
      checkExecutable: () => false,
    });

    await manager.create({ sessionId: "session-1", command: "pwd" });

    expect(spawns[0]).toMatchObject({ file: "/bin/zsh", args: ["-lc", "pwd"] });
  });

  it("keeps explicit command/args semantics regardless of shell validity", async () => {
    const { manager, spawns } = createHarness({
      env: { PATH: "/usr/bin", SHELL: "/definitely/not/a/shell" },
      checkExecutable: () => false,
    });

    await manager.create({
      sessionId: "session-1",
      command: "/bin/echo",
      args: ["explicit"],
    });

    expect(spawns[0]).toMatchObject({ file: "/bin/echo", args: ["explicit"] });
  });

  it("wraps pty.spawn failures in a spawn error with sanitized diagnostics", async () => {
    const moduleDir = mkdtempSync(join(tmpdir(), "carrent-acp-diag-"));
    const helperDir = join(moduleDir, "prebuilds", "darwin-arm64");
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(helperDir, "spawn-helper"), "not a mach-o");
    chmodSync(join(helperDir, "spawn-helper"), 0o755);
    const original = new Error("posix_spawnp failed.");

    const { manager } = createHarness({
      ptyModuleDir: () => moduleDir,
      pty: {
        spawn() {
          throw original;
        },
      },
    });

    let rejection: unknown;
    try {
      await manager.create({
        sessionId: "session-1",
        command: "echo hello",
        env: [{ name: "SECRET_TOKEN", value: "hunter2" }],
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection instanceof AcpTerminalSpawnError).toBe(true);
    const failure = rejection as AcpTerminalSpawnError;
    expect(failure.cause).toBe(original);
    expect(failure.message).toContain("ACP terminal spawn failed");
    expect(failure.message).toContain("posix_spawnp failed.");
    expect(failure.message).toContain("/bin/zsh");
    expect(failure.message).not.toContain("hunter2");
    expect(failure.diagnostics).toMatchObject({
      phase: "pty.spawn",
      platform: "darwin",
      arch: "arm64",
      appEnvironment: "dev",
      file: "/bin/zsh",
      argCount: 2,
      legacyCommand: true,
      cwd: "/workspace",
      cwdExists: false,
      shell: { selected: "/bin/zsh", source: "env.SHELL", executable: true },
      requestEnvNames: ["SECRET_TOKEN"],
      ptyModuleDir: moduleDir,
      error: { message: "posix_spawnp failed." },
    });
    const helper = failure.diagnostics.ptyHelpers.find((candidate) =>
      candidate.path.endsWith("prebuilds/darwin-arm64/spawn-helper"),
    );
    expect(helper).toMatchObject({
      exists: true,
      executableBit: true,
      mode: "0755",
      machOArch: null,
    });
    expect(JSON.stringify(failure.diagnostics)).not.toContain("hunter2");
  });

  it("points at the missing executable bit when a helper cannot be executed", async () => {
    const moduleDir = mkdtempSync(join(tmpdir(), "carrent-acp-perm-"));
    const helperDir = join(moduleDir, "prebuilds", "darwin-arm64");
    mkdirSync(helperDir, { recursive: true });
    // npm's node-pty prebuilds ship spawn-helper as 0644; posix_spawn then
    // fails with EACCES, which node-pty reports as "posix_spawnp failed."
    writeFileSync(join(helperDir, "spawn-helper"), "helper bytes", { mode: 0o644 });
    const { manager } = createHarness({
      ptyModuleDir: () => moduleDir,
      pty: {
        spawn() {
          throw new Error("posix_spawnp failed.");
        },
      },
    });

    let rejection: unknown;
    try {
      await manager.create({ sessionId: "session-1", command: "echo hello" });
    } catch (error) {
      rejection = error;
    }

    const failure = rejection as AcpTerminalSpawnError;
    expect(failure.message).toContain("executable bit");
    expect(failure.message).toContain("scripts/fix-node-pty-permissions");
  });

  it("points at the macOS provenance block when a helper carries downloaded provenance", async () => {
    const moduleDir = mkdtempSync(join(tmpdir(), "carrent-acp-prov-"));
    const helperDir = join(moduleDir, "prebuilds", "darwin-arm64");
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(helperDir, "spawn-helper"), "helper bytes");
    chmodSync(join(helperDir, "spawn-helper"), 0o755);
    const { manager } = createHarness({
      readProvenance: () => "01 02 00 A3 D0 16 65 59 CD 76 01",
      ptyModuleDir: () => moduleDir,
      pty: {
        spawn() {
          throw new Error("posix_spawnp failed.");
        },
      },
    });

    let rejection: unknown;
    try {
      await manager.create({ sessionId: "session-1", command: "echo hello" });
    } catch (error) {
      rejection = error;
    }

    const failure = rejection as AcpTerminalSpawnError;
    expect(failure.message).toContain("com.apple.provenance");
    expect(failure.message).toContain("scripts/fix-node-pty-permissions.ts");
    const helper = failure.diagnostics.ptyHelpers.find((candidate) =>
      candidate.path.endsWith("prebuilds/darwin-arm64/spawn-helper"),
    );
    expect(helper?.provenanceHex).toBe("01 02 00 A3 D0 16 65 59 CD 76 01");
  });

  it("does not claim a provenance block for other spawn errors", async () => {
    const moduleDir = mkdtempSync(join(tmpdir(), "carrent-acp-prov-negative-"));
    const helperDir = join(moduleDir, "prebuilds", "darwin-arm64");
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(helperDir, "spawn-helper"), "helper bytes");
    const { manager } = createHarness({
      readProvenance: () => "01 02 00 A3 D0 16 65 59 CD 76 01",
      ptyModuleDir: () => moduleDir,
      pty: {
        spawn() {
          throw new Error("cwd does not exist");
        },
      },
    });

    let rejection: unknown;
    try {
      await manager.create({ sessionId: "session-1", command: "echo hello" });
    } catch (error) {
      rejection = error;
    }

    const failure = rejection as AcpTerminalSpawnError;
    expect(failure.message).not.toContain("likely blocking");
  });
});

describe("resolveAcpTerminalShell", () => {
  it("prefers an executable env.SHELL on unix", () => {
    const selection = resolveAcpTerminalShell({
      env: { SHELL: "/usr/local/bin/fish" },
      platform: "darwin",
      fallbackShell: "/bin/zsh",
      checkExecutable: () => true,
    });

    expect(selection).toEqual({ shell: "/usr/local/bin/fish", source: "env.SHELL" });
  });

  it("falls back when env.SHELL is relative or not executable", () => {
    for (const env of [{ SHELL: "zsh" }, { SHELL: "/missing/shell" }, {}]) {
      const selection = resolveAcpTerminalShell({
        env,
        platform: "linux",
        fallbackShell: "/bin/zsh",
        checkExecutable: (path) => path === "/bin/zsh",
      });

      expect(selection).toEqual({ shell: "/bin/zsh", source: "fallback" });
    }
  });

  it("validates env.COMSPEC the same way on Windows", () => {
    expect(
      resolveAcpTerminalShell({
        env: { COMSPEC: "C:\\Windows\\system32\\cmd.exe" },
        platform: "win32",
        fallbackShell: "cmd.exe",
        checkExecutable: () => true,
      }),
    ).toEqual({ shell: "C:\\Windows\\system32\\cmd.exe", source: "env.COMSPEC" });

    expect(
      resolveAcpTerminalShell({
        env: { COMSPEC: "Z:\\gone\\cmd.exe" },
        platform: "win32",
        fallbackShell: "powershell.exe",
        checkExecutable: () => false,
      }),
    ).toEqual({ shell: "powershell.exe", source: "fallback" });
  });
});
