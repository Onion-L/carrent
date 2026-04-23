import { spawn, type ChildProcess } from "node:child_process";
import type { RuntimeId, RuntimeStatus } from "../../src/shared/runtimes";
import { runtimeCatalog } from "./runtimeCatalog";

interface ProcessEntry {
  process: ChildProcess;
  startedAt: string;
}

export class RuntimeProcessManager {
  private processes = new Map<RuntimeId, ProcessEntry>();

  start(runtimeId: RuntimeId): { pid: number; startedAt: string } {
    const runtime = runtimeCatalog.find((r) => r.id === runtimeId);
    if (!runtime) {
      throw new Error(`Unknown runtime: ${runtimeId}`);
    }

    this.stop(runtimeId);

    const child = spawn(runtime.command, [], {
      detached: false,
      stdio: "ignore",
      shell: false,
    });

    const startedAt = new Date().toISOString();
    this.processes.set(runtimeId, { process: child, startedAt });

    child.on("exit", () => {
      this.processes.delete(runtimeId);
    });

    if (!child.pid) {
      throw new Error(`Failed to spawn runtime process: ${runtime.command}`);
    }

    return { pid: child.pid, startedAt };
  }

  stop(runtimeId: RuntimeId): boolean {
    const entry = this.processes.get(runtimeId);
    if (!entry) {
      return false;
    }

    const killed = entry.process.kill();
    this.processes.delete(runtimeId);
    return killed;
  }

  restart(runtimeId: RuntimeId): { pid: number; startedAt: string } {
    this.stop(runtimeId);
    return this.start(runtimeId);
  }

  getStatus(runtimeId: RuntimeId): RuntimeStatus {
    const entry = this.processes.get(runtimeId);
    if (!entry) {
      return "stopped";
    }

    try {
      process.kill(entry.process.pid!, 0);
      return "running";
    } catch {
      this.processes.delete(runtimeId);
      return "stopped";
    }
  }

  getEntry(runtimeId: RuntimeId): { pid: number; startedAt: string } | undefined {
    const entry = this.processes.get(runtimeId);
    if (!entry || !entry.process.pid) {
      return undefined;
    }
    return { pid: entry.process.pid, startedAt: entry.startedAt };
  }

  startAll(): Array<{ runtimeId: RuntimeId; pid: number; startedAt: string }> {
    const results: Array<{ runtimeId: RuntimeId; pid: number; startedAt: string }> = [];
    for (const runtime of runtimeCatalog) {
      try {
        const { pid, startedAt } = this.start(runtime.id);
        results.push({ runtimeId: runtime.id, pid, startedAt });
      } catch {
        // skip runtimes that fail to start
      }
    }
    return results;
  }

  stopAll(): RuntimeId[] {
    const stopped: RuntimeId[] = [];
    for (const runtimeId of this.processes.keys()) {
      if (this.stop(runtimeId)) {
        stopped.push(runtimeId);
      }
    }
    return stopped;
  }

  restartAll(): Array<{ runtimeId: RuntimeId; pid: number; startedAt: string }> {
    this.stopAll();
    return this.startAll();
  }
}

export const runtimeProcessManager = new RuntimeProcessManager();
