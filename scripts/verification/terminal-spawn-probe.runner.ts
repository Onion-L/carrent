/**
 * Runner half of the terminal spawn probe (plan 007, phase 1). This file is
 * bundled by terminal-spawn-probe.ts and executed under the target Electron
 * binary with ELECTRON_RUN_AS_NODE=1, because node-pty's event delivery does
 * not work under the Bun runtime.
 *
 * Usage: <electron> runner.cjs '<spec-json>'
 *
 * Spec: { nodePtyPath, moduleDir, appEnvironment, cases: [{ name, request, env }] }
 * Prints a single JSON report on stdout; spawn failures carry the
 * AcpTerminalSpawnError message and its sanitized diagnostics.
 */
import { createRequire } from "node:module";

import {
  AcpTerminalSpawnError,
  createAcpTerminalManager,
  type AcpTerminalCreateRequest,
} from "../../apps/desktop/electron/chat/acpTerminalManager";

type ProbeCase = {
  name: string;
  /** terminal/create request without sessionId. */
  request: Omit<AcpTerminalCreateRequest, "sessionId">;
  /** Base environment for the manager; overrides the runner's own env. */
  env?: NodeJS.ProcessEnv;
  /** Substring the retained output must contain. */
  marker: string;
};

type ProbeSpec = {
  nodePtyPath: string;
  moduleDir: string | null;
  appEnvironment: "dev" | "packaged";
  cwd: string;
  cases: ProbeCase[];
  timeoutMs: number;
};

type CaseResult = {
  name: string;
  status: "ok" | "failed" | "error";
  exitStatus?: unknown;
  outputTail?: string;
  error?: string;
  diagnostics?: unknown;
};

const spec = JSON.parse(process.argv[2] ?? "") as ProbeSpec;
const localRequire = createRequire(import.meta.url);
const pty = localRequire(spec.nodePtyPath) as {
  spawn: Parameters<typeof createAcpTerminalManager>[0]["pty"]["spawn"];
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function runCase(probeCase: ProbeCase): Promise<CaseResult> {
  const manager = createAcpTerminalManager({
    pty,
    cwd: spec.cwd,
    ...(probeCase.env ? { env: probeCase.env } : {}),
    appEnvironment: spec.appEnvironment,
    ptyModuleDir: () => spec.moduleDir,
  });
  try {
    const created = await manager.create({ sessionId: "probe", ...probeCase.request });
    const target = { sessionId: "probe", terminalId: created.terminalId };
    const exitStatus = await withTimeout(manager.waitForExit(target), spec.timeoutMs);
    const { output } = await manager.output(target);
    const ok = exitStatus.exitCode === 0 && output.includes(probeCase.marker);
    return {
      name: probeCase.name,
      status: ok ? "ok" : "failed",
      exitStatus,
      outputTail: output.slice(-2000),
      ...(ok
        ? {}
        : {
            error: `expected marker ${JSON.stringify(probeCase.marker)} in output of exit-0 process`,
          }),
    };
  } catch (error) {
    if (error instanceof AcpTerminalSpawnError) {
      return {
        name: probeCase.name,
        status: "error",
        error: error.message,
        diagnostics: error.diagnostics,
      };
    }
    return {
      name: probeCase.name,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await manager.close().catch(() => {});
  }
}

const results: CaseResult[] = [];
void (async () => {
  for (const probeCase of spec.cases) {
    results.push(await runCase(probeCase));
  }
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.log(
    JSON.stringify({
      results,
      runnerError: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
