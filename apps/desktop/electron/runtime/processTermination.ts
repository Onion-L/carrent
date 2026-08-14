import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface ProcessTerminationDeps {
  platform?: NodeJS.Platform;
  runTaskkill?: (args: string[]) => {
    on: (event: "error", listener: (error: Error) => void) => unknown;
  };
}

// On Windows, kill() is TerminateProcess on the direct child only. A CLI
// wrapped in cmd.exe would leave its grandchildren running, so termination
// goes through taskkill /T, which ends the whole tree.
export function killProcessTree(
  child: Pick<ChildProcess, "pid" | "kill">,
  deps: ProcessTerminationDeps = {},
): boolean {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32" && child.pid != null) {
    try {
      const killer = (deps.runTaskkill ?? defaultRunTaskkill)([
        "/pid",
        String(child.pid),
        "/T",
        "/F",
      ]);
      killer.on("error", () => child.kill());
      return true;
    } catch {
      return child.kill();
    }
  }
  return child.kill();
}

function defaultRunTaskkill(args: string[]) {
  return spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
}
