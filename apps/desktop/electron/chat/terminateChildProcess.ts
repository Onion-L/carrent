import type { ChildProcess } from "node:child_process";

export function terminateChildProcess(child: ChildProcess, gracePeriodMs = 5_000): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) {
    return Promise.resolve();
  }

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
        reject(new Error("Runtime process did not exit after SIGKILL."));
      }, gracePeriodMs);
    }, gracePeriodMs);
  });
}
