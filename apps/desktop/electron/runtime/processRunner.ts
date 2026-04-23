import { execFile } from "node:child_process";

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

export function createProcessRunner(): ProcessRunner {
  return {
    run(command, args, options) {
      return new Promise<ProcessRunnerResult>((resolve) => {
        execFile(
          command,
          args,
          {
            cwd: options?.cwd,
            env: options?.env,
            timeout: options?.timeoutMs,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
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
              exitCode:
                typeof childError.code === "number" ? childError.code : null,
              stdout,
              stderr,
              errorCode:
                typeof childError.code === "string" ? childError.code : undefined,
              signal: childError.signal ?? null,
              timedOut: childError.killed === true && options?.timeoutMs != null,
            });
          },
        );
      });
    },
  };
}
