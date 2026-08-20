import type { ChildProcess } from "node:child_process";
import { killProcessTree, type ProcessTerminationDeps } from "../runtime/processTermination";

export type TerminateChildProcessDeps = Pick<ProcessTerminationDeps, "platform" | "runTaskkill">;

export function terminateChildProcess(
  child: ChildProcess,
  gracePeriodMs = 5_000,
  deps: TerminateChildProcessDeps = {},
): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) {
    return Promise.resolve();
  }

  const platform = deps.platform ?? process.platform;
  return new Promise((resolve, reject) => {
    let escalationTimer: ReturnType<typeof setTimeout> | null = null;
    let failureTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (escalationTimer) clearTimeout(escalationTimer);
      if (failureTimer) clearTimeout(failureTimer);
      child.removeListener("close", handleClose);
      child.removeListener("error", handleError);
    };
    const handleClose = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    child.once("close", handleClose);
    child.once("error", handleError);

    // Every Windows signal is TerminateProcess, so the SIGTERM -> SIGKILL
    // ladder has no graceful phase there; the only meaningful step is taking
    // the whole cmd.exe-wrapped process tree down at once.
    if (platform === "win32") {
      try {
        killProcessTree(child, deps);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      failureTimer = setTimeout(() => {
        cleanup();
        reject(new Error("Agent process did not exit after taskkill."));
      }, gracePeriodMs);
      return;
    }

    try {
      child.kill("SIGTERM");
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }

    escalationTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      failureTimer = setTimeout(() => {
        cleanup();
        reject(new Error("Agent process did not exit after SIGKILL."));
      }, gracePeriodMs);
    }, gracePeriodMs);
  });
}
