import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import os from "node:os";

import type { PtyAdapter, PtyProcess } from "../terminal/terminalSessionManager";

const DEFAULT_OUTPUT_BYTE_LIMIT = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTE_LIMIT = 16 * 1024 * 1024;

type TerminalTarget = {
  sessionId: string;
  terminalId: string;
};

export type AcpTerminalCreateRequest = {
  sessionId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Array<{ name: string; value: string }>;
  outputByteLimit?: number;
};

export type AcpTerminalExitStatus = {
  exitCode?: number;
  signal?: string;
};

export type AcpTerminalManager = {
  create: (request: AcpTerminalCreateRequest) => Promise<{ terminalId: string }>;
  output: (request: TerminalTarget) => Promise<{
    output: string;
    truncated: boolean;
    exitStatus?: AcpTerminalExitStatus;
  }>;
  waitForExit: (request: TerminalTarget) => Promise<AcpTerminalExitStatus>;
  kill: (request: TerminalTarget) => Promise<Record<string, never>>;
  release: (request: TerminalTarget) => Promise<Record<string, never>>;
  close: () => Promise<void>;
};

type Session = {
  id: string;
  sessionId: string;
  process: PtyProcess;
  output: string;
  outputByteLimit: number;
  truncated: boolean;
  exitStatus: AcpTerminalExitStatus | null;
  resolveExit: (status: AcpTerminalExitStatus) => void;
  exitPromise: Promise<AcpTerminalExitStatus>;
  disposables: Array<{ dispose: () => void }>;
};

function terminalEnvironment(env: NodeJS.ProcessEnv) {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string" && !name.startsWith("ELECTRON_RUN_AS_NODE")) {
      result[name] = value;
    }
  }
  return result;
}

function outputByteLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_OUTPUT_BYTE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("ACP terminal outputByteLimit is invalid.");
  }
  return Math.min(value, MAX_OUTPUT_BYTE_LIMIT);
}

function retainOutput(session: Session, data: string) {
  session.output += data;
  const bytes = Buffer.from(session.output, "utf8");
  if (bytes.length <= session.outputByteLimit) return;

  let start = bytes.length - session.outputByteLimit;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) {
    start += 1;
  }
  session.output = bytes.subarray(start).toString("utf8");
  session.truncated = true;
}

function signalName(signal: number | undefined) {
  if (!signal) return null;
  return (
    Object.entries(os.constants.signals).find(([, value]) => value === signal)?.[0] ??
    String(signal)
  );
}

function exitStatus(event: { exitCode: number; signal?: number }): AcpTerminalExitStatus {
  const signal = signalName(event.signal);
  return signal ? { signal } : { exitCode: Math.max(0, event.exitCode) };
}

export function createAcpTerminalManager({
  pty,
  cwd,
  env = process.env,
  platform = process.platform,
  fallbackShell = platform === "win32" ? env.COMSPEC || "cmd.exe" : "/bin/zsh",
  createId = () => randomUUID(),
}: {
  pty: PtyAdapter;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fallbackShell?: string;
  createId?: () => string;
}): AcpTerminalManager {
  const sessions = new Map<string, Session>();

  const find = ({ sessionId, terminalId }: TerminalTarget) => {
    const session = sessions.get(terminalId);
    if (!session || session.sessionId !== sessionId) {
      throw new Error("ACP terminal is unavailable.");
    }
    return session;
  };

  const finish = (session: Session, status: AcpTerminalExitStatus) => {
    if (session.exitStatus) return;
    session.exitStatus = status;
    session.resolveExit(status);
  };

  const release = (session: Session, kill: boolean) => {
    if (kill && !session.exitStatus) {
      session.process.kill();
      finish(session, { signal: "SIGTERM" });
    }
    session.disposables.forEach((disposable) => disposable.dispose());
    sessions.delete(session.id);
  };

  return {
    async create(request) {
      if (!request.sessionId || !request.command) {
        throw new Error("ACP terminal sessionId and command are required.");
      }
      if (
        request.args !== undefined &&
        !request.args.every((argument) => typeof argument === "string")
      ) {
        throw new Error("ACP terminal args are invalid.");
      }
      const workingDirectory = request.cwd ?? cwd;
      if (!isAbsolute(workingDirectory)) {
        throw new Error("ACP terminal cwd must be absolute.");
      }
      const retainedOutputByteLimit = outputByteLimit(request.outputByteLimit);

      const launchEnvironment = terminalEnvironment(env);
      for (const variable of request.env ?? []) {
        if (!variable.name || typeof variable.value !== "string") {
          throw new Error("ACP terminal env is invalid.");
        }
        launchEnvironment[variable.name] = variable.value;
      }

      const legacyCommand = request.args === undefined;
      const shell =
        platform === "win32" ? env.COMSPEC || fallbackShell : env.SHELL || fallbackShell;
      const file = legacyCommand ? shell : request.command;
      const args = legacyCommand
        ? platform === "win32"
          ? ["/d", "/s", "/c", request.command]
          : ["-lc", request.command]
        : request.args!;
      const id = createId();
      if (!id || sessions.has(id)) {
        throw new Error("ACP terminal identity is invalid.");
      }

      const process = pty.spawn(file, args, {
        cwd: workingDirectory,
        cols: 80,
        rows: 24,
        name: launchEnvironment.TERM || "xterm-256color",
        env: launchEnvironment,
      });
      let resolveExit: (status: AcpTerminalExitStatus) => void = () => {};
      const exitPromise = new Promise<AcpTerminalExitStatus>((resolve) => {
        resolveExit = resolve;
      });
      const session: Session = {
        id,
        sessionId: request.sessionId,
        process,
        output: "",
        outputByteLimit: retainedOutputByteLimit,
        truncated: false,
        exitStatus: null,
        resolveExit,
        exitPromise,
        disposables: [],
      };
      sessions.set(id, session);
      session.disposables.push(
        process.onData((data) => retainOutput(session, data)),
        process.onExit((event) => finish(session, exitStatus(event))),
      );
      return { terminalId: id };
    },

    async output(request) {
      const session = find(request);
      return {
        output: session.output,
        truncated: session.truncated,
        ...(session.exitStatus ? { exitStatus: session.exitStatus } : {}),
      };
    },

    async waitForExit(request) {
      return find(request).exitPromise;
    },

    async kill(request) {
      const session = find(request);
      if (!session.exitStatus) session.process.kill();
      return {};
    },

    async release(request) {
      release(find(request), true);
      return {};
    },

    async close() {
      [...sessions.values()].forEach((session) => release(session, true));
    },
  };
}
