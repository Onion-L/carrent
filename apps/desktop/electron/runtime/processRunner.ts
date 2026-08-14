import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { resolveCommandLaunch } from "./commandLaunch";
import { killProcessTree } from "./processTermination";

export interface ProcessRunnerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface ProcessRunnerResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
}

export interface ProcessRunner {
  run: (
    command: string,
    args: string[],
    options?: ProcessRunnerOptions,
  ) => Promise<ProcessRunnerResult>;
}

export interface ProcessRunnerDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execFile?: typeof execFile;
}

export function createProcessRunner(deps: ProcessRunnerDeps = {}): ProcessRunner {
  const execute = deps.execFile ?? execFile;
  return {
    run(command, args, options) {
      const launch = resolveCommandLaunch(command, args, {
        platform: deps.platform,
        env: deps.env,
      });
      return new Promise<ProcessRunnerResult>((resolve) => {
        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const childProcess = execute(
          launch.command,
          launch.args,
          {
            cwd: options?.cwd,
            env: options?.env,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (timeoutHandle != null) {
              clearTimeout(timeoutHandle);
            }

            if (!error) {
              resolve({
                ok: true,
                exitCode: 0,
                stdout,
                stderr,
                signal: null,
                timedOut: false,
              });
              return;
            }

            const childError = error as NodeJS.ErrnoException & {
              code?: number | string;
              killed?: boolean;
              signal?: NodeJS.Signals | null;
            };

            resolve({
              ok: false,
              exitCode: typeof childError.code === "number" ? childError.code : null,
              stdout,
              stderr,
              errorCode: typeof childError.code === "string" ? childError.code : undefined,
              signal: childError.signal ?? null,
              timedOut,
            });
          },
        ) as ChildProcess;
        childProcess.stdin?.end();

        timeoutHandle =
          options?.timeoutMs == null
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                killProcessTree(childProcess, { platform: deps.platform });
              }, options.timeoutMs);
      });
    },
  };
}
