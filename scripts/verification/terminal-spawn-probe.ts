/**
 * Terminal spawn smoke probe (plan 007, phase 1): proves that the real
 * `terminal/create -> pty.spawn` path works in dev and in every packaged .app
 * found under apps/desktop/release, across shell and request-shape variants.
 *
 * Usage:
 *   bun scripts/verification/terminal-spawn-probe.ts [--output report.json]
 *
 * The probe bundles terminal-spawn-probe.runner.ts and executes it under the
 * target Electron binary (ELECTRON_RUN_AS_NODE=1), because node-pty event
 * delivery does not work under the Bun runtime.
 *
 * - Environments that cannot run (no Electron binary, no .app, missing
 *   Rosetta for x64) are reported as SKIPPED, never as passed.
 * - Exit code is non-zero when any executed case fails or a probe environment
 *   errors. Skips alone keep the exit code at 0.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUNNER_ENTRY = join(import.meta.dirname, "terminal-spawn-probe.runner.ts");
const RUN_TIMEOUT_MS = 60_000;
const CASE_TIMEOUT_MS = 15_000;

type EnvironmentSpec = {
  name: string;
  kind: "dev" | "packaged";
  binary: string;
  nodePtyPath: string;
  moduleDir: string | null;
  appEnvironment: "dev" | "packaged";
  skipReason?: string;
};

type HelperInventory = {
  path: string;
  mode: string;
  executableBit: boolean;
  machOArch: string | null;
};

function machOArch(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = new Uint8Array(8);
    if (readSync(fd, buffer, 0, 8, 0) < 8) return null;
    const view = new DataView(buffer.buffer);
    const magicLE = view.getUint32(0, true);
    if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) {
      const cpu = view.getUint32(4, true);
      if (cpu === 0x0100000c) return "arm64";
      if (cpu === 0x01000007) return "x86_64";
      return null;
    }
    if (view.getUint32(0, false) === 0xcafebabe) return `fat:${view.getUint32(4, false)}`;
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function collectHelpers(root: string, found: HelperInventory[] = []): HelperInventory[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) collectHelpers(path, found);
    else if (entry.isFile() && (entry.name === "spawn-helper" || entry.name === "pty.node")) {
      const mode = statSync(path).mode & 0o777;
      found.push({
        path,
        mode: mode.toString(8).padStart(4, "0"),
        executableBit: (mode & 0o111) !== 0,
        machOArch: machOArch(path),
      });
    }
  }
  return found;
}

function findEnvironments(): EnvironmentSpec[] {
  const environments: EnvironmentSpec[] = [];
  const devElectron = join(
    REPO_ROOT,
    "apps",
    "desktop",
    "node_modules",
    "electron",
    "dist",
    "Electron.app",
    "Contents",
    "MacOS",
    "Electron",
  );
  const devPty = join(REPO_ROOT, "apps", "desktop", "node_modules", "node-pty");
  environments.push(
    existsSync(devElectron) && existsSync(devPty)
      ? {
          name: "dev",
          kind: "dev",
          binary: devElectron,
          nodePtyPath: devPty,
          moduleDir: devPty,
          appEnvironment: "dev",
        }
      : {
          name: "dev",
          kind: "dev",
          binary: devElectron,
          nodePtyPath: devPty,
          moduleDir: null,
          appEnvironment: "dev",
          skipReason: "apps/desktop dev dependencies not installed",
        },
  );

  const releaseDir = join(REPO_ROOT, "apps", "desktop", "release");
  let buildDirs: string[] = [];
  try {
    buildDirs = readdirSync(releaseDir);
  } catch {
    buildDirs = [];
  }
  for (const dir of buildDirs.sort()) {
    const app = join(releaseDir, dir, "Carrent.app");
    const binary = join(app, "Contents", "MacOS", "Carrent");
    const unpackedPty = join(
      app,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "node-pty",
    );
    const asarPty = join(app, "Contents", "Resources", "app.asar", "node_modules", "node-pty");
    if (!existsSync(binary)) continue;
    const appArch = machOArch(binary);
    const needsRosetta = process.arch === "arm64" && appArch === "x86_64";
    const rosettaAvailable =
      needsRosetta &&
      (() => {
        try {
          execFileSync("/usr/bin/arch", ["-x86_64", "/usr/bin/true"], { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      })();
    const archMismatch = appArch !== null && appArch !== process.arch && !appArch.startsWith("fat");
    const skipReason = !existsSync(unpackedPty)
      ? "node-pty not unpacked in the packaged app"
      : needsRosetta && !rosettaAvailable
        ? "x64 build cannot run: Rosetta 2 is not installed"
        : archMismatch && !needsRosetta
          ? `app arch ${appArch} does not match host ${process.arch}`
          : undefined;
    environments.push(
      skipReason
        ? {
            name: `packaged:${dir}`,
            kind: "packaged",
            binary,
            nodePtyPath: asarPty,
            moduleDir: existsSync(unpackedPty) ? unpackedPty : null,
            appEnvironment: "packaged",
            skipReason,
          }
        : {
            name: `packaged:${dir}`,
            kind: "packaged",
            binary,
            // The runner runs under the app's own Electron binary and requires
            // node-pty through the app.asar path (resolved by Electron's asar
            // shim), which is what the shipped main bundle does; node-pty then
            // remaps it to app.asar.unpacked for the native helper. The asar
            // path does not exist on the plain filesystem, so its presence is
            // judged by the unpacked copy.
            nodePtyPath: asarPty,
            moduleDir: unpackedPty,
            appEnvironment: "packaged",
          },
    );
  }
  return environments;
}

function probeCases(marker: string, scratchDir: string) {
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin:/usr/local/bin",
    TERM: "xterm-256color",
  };
  return [
    {
      name: "legacy-shell-command",
      request: { command: `echo ${marker}-legacy` },
      env: { ...baseEnv, SHELL: "/bin/zsh" },
      marker: `${marker}-legacy`,
    },
    {
      name: "explicit-command-args",
      request: { command: "/bin/echo", args: [`${marker}-explicit`] },
      env: baseEnv,
      marker: `${marker}-explicit`,
    },
    {
      name: "working-directory",
      request: { command: "pwd", cwd: scratchDir },
      env: { ...baseEnv, SHELL: "/bin/zsh" },
      marker: scratchDir,
    },
    {
      name: "shell-unset",
      request: { command: `echo ${marker}-noshell` },
      env: baseEnv,
      marker: `${marker}-noshell`,
    },
    {
      name: "shell-invalid",
      request: { command: `echo ${marker}-badshell` },
      env: { ...baseEnv, SHELL: "/definitely/not/a/shell" },
      marker: `${marker}-badshell`,
    },
  ];
}

type RunnerResult = {
  results: Array<{
    name: string;
    status: "ok" | "failed" | "error";
    exitStatus?: unknown;
    outputTail?: string;
    error?: string;
    diagnostics?: unknown;
  }>;
};

function runEnvironment(
  environment: EnvironmentSpec,
  runnerPath: string,
  scratchDir: string,
): Promise<{ report: RunnerResult | null; error?: string; stderrTail?: string }> {
  return new Promise((resolvePromise) => {
    const marker = `PTYSMOKE-${process.pid}`;
    const spec = {
      nodePtyPath: environment.nodePtyPath,
      moduleDir: environment.moduleDir,
      appEnvironment: environment.appEnvironment,
      cwd: scratchDir,
      timeoutMs: CASE_TIMEOUT_MS,
      cases: probeCases(marker, scratchDir),
    };
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(environment.binary, [runnerPath, JSON.stringify(spec)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
    } catch (error) {
      resolvePromise({ report: null, error: `spawn failed: ${errorMessage(error)}` });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({
        report: null,
        error: `timed out after ${RUN_TIMEOUT_MS}ms`,
        stderrTail: stderr.slice(-2000),
      });
    }, RUN_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ report: null, error: `spawn error: ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolvePromise({ report: JSON.parse(stdout) as RunnerResult });
      } catch {
        resolvePromise({
          report: null,
          error: `runner exited ${code} without a JSON report`,
          stderrTail: stderr.slice(-2000),
        });
      }
    });
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;

const root = mkdtempSync(join(tmpdir(), "carrent-pty-probe-"));
const buildDir = join(root, "build");
try {
  const build = await Bun.build({
    entrypoints: [RUNNER_ENTRY],
    outdir: buildDir,
    target: "node",
    format: "cjs",
    external: ["node-pty"],
  });
  if (!build.success) {
    for (const log of build.logs) console.error(log);
    console.log(JSON.stringify({ status: "error", reason: "runner bundle failed to build" }));
    process.exit(2);
  }
  const runnerPath = build.outputs[0]!.path;

  const environments = findEnvironments();
  const reports = [];
  let anyFailure = false;
  for (const environment of environments) {
    if (environment.skipReason) {
      console.error(`[env] ${environment.name} -> SKIPPED (${environment.skipReason})`);
      reports.push({
        name: environment.name,
        kind: environment.kind,
        status: "skipped",
        reason: `SKIPPED: ${environment.skipReason}`,
        helpers: environment.moduleDir ? collectHelpers(environment.moduleDir) : [],
      });
      continue;
    }
    console.error(`[env] ${environment.name}`);
    const { report, error, stderrTail } = await runEnvironment(environment, runnerPath, root);
    if (!report) {
      anyFailure = true;
      console.error(`[env] ${environment.name} -> ERROR`);
      reports.push({
        name: environment.name,
        kind: environment.kind,
        status: "error",
        error,
        stderrTail,
        helpers: environment.moduleDir ? collectHelpers(environment.moduleDir) : [],
      });
      continue;
    }
    const failed = report.results.filter((result) => result.status !== "ok");
    anyFailure ||= failed.length > 0;
    console.error(
      `[env] ${environment.name} -> ${failed.length === 0 ? "ok" : `FAILED (${failed.map((r) => r.name).join(", ")})`}`,
    );
    reports.push({
      name: environment.name,
      kind: environment.kind,
      status: failed.length === 0 ? "ok" : "failed",
      helpers: environment.moduleDir ? collectHelpers(environment.moduleDir) : [],
      results: report.results,
    });
  }

  const report = {
    status: anyFailure ? "failed" : "ok",
    generatedAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch },
    environments: reports,
  };
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (outputPath) writeFileSync(outputPath, json);
  process.exit(anyFailure ? 1 : 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}
