import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  openSync,
  readSync,
  closeSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, win32 } from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

import type { PtyAdapter, PtyProcess } from "../terminal/terminalSessionManager";

const DEFAULT_OUTPUT_BYTE_LIMIT = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTE_LIMIT = 16 * 1024 * 1024;
/**
 * com.apple.provenance origin prefix observed on locally created/rewritten
 * binaries, which macOS allows to exec. npm-downloaded node-pty prebuilt
 * helpers carry other (per-file, dynamic) origins that Gatekeeper refuses to
 * exec with EACCES even when the mode is 0755 and the embedded signature is
 * valid; node-pty reports that as a bare "posix_spawnp failed.". Provenance
 * values are not stable across files, so the check is "present and not the
 * local origin". Shared with scripts/fix-node-pty-permissions.ts, which
 * performs the inode-rewrite reset in dev installs.
 */
export const LOCAL_PROVENANCE_PREFIX = "01 02 00 48";

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

export type AcpTerminalShellSelection = {
  shell: string;
  source: "env.SHELL" | "env.COMSPEC" | "fallback";
};

function defaultCheckExecutable(path: string): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Legacy Kimi commands run through a login shell. A missing or non-executable
// SHELL must not take down the whole terminal channel, so unusable values fall
// back to the platform default shell instead of reaching pty.spawn.
export function resolveAcpTerminalShell({
  env,
  platform,
  fallbackShell,
  checkExecutable = defaultCheckExecutable,
}: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  fallbackShell: string;
  checkExecutable?: (path: string) => boolean;
}): AcpTerminalShellSelection {
  const preferred = platform === "win32" ? env.COMSPEC : env.SHELL;
  const source = platform === "win32" ? "env.COMSPEC" : "env.SHELL";
  const absolute =
    platform === "win32"
      ? (value: string) => win32.isAbsolute(value)
      : (value: string) => isAbsolute(value);
  if (preferred && absolute(preferred) && checkExecutable(preferred)) {
    return { shell: preferred, source };
  }
  return { shell: fallbackShell, source: "fallback" };
}

export type AcpTerminalHelperProbe = {
  path: string;
  exists: boolean;
  ptyNodeExists: boolean;
  mode: string | null;
  executableBit: boolean;
  machOArch: string | null;
  provenanceHex: string | null;
};

export type AcpTerminalSpawnDiagnostics = {
  phase: "pty.spawn";
  platform: NodeJS.Platform;
  arch: string;
  appEnvironment: "dev" | "packaged";
  file: string;
  argCount: number;
  legacyCommand: boolean;
  cwd: string;
  cwdExists: boolean;
  shell: {
    selected: string;
    source: AcpTerminalShellSelection["source"];
    executable: boolean;
  } | null;
  requestEnvNames: string[];
  ptyModuleDir: string | null;
  ptyHelpers: AcpTerminalHelperProbe[];
  error: { name: string; message: string; code: string | null };
};

// node-pty's Apple code path collapses every failure — PTY setup included —
// into "posix_spawnp failed." with no errno. This error keeps the original as
// `cause` and adds the environment evidence needed to tell shell, helper,
// permission, and path problems apart.
export class AcpTerminalSpawnError extends Error {
  readonly diagnostics: AcpTerminalSpawnDiagnostics;

  constructor(diagnostics: AcpTerminalSpawnDiagnostics, cause: Error) {
    super(buildSpawnFailureMessage(diagnostics), { cause });
    this.name = "AcpTerminalSpawnError";
    this.diagnostics = diagnostics;
  }
}

function buildSpawnFailureMessage(diagnostics: AcpTerminalSpawnDiagnostics): string {
  const lines = [
    `ACP terminal spawn failed at ${diagnostics.phase} ` +
      `(${diagnostics.platform}/${diagnostics.arch}, ${diagnostics.appEnvironment}): ` +
      `${diagnostics.error.message}`,
    `Target file=${JSON.stringify(diagnostics.file)} ` +
      `(${diagnostics.legacyCommand ? "legacy shell command" : "explicit command"}, ` +
      `${diagnostics.argCount} args), cwd=${JSON.stringify(diagnostics.cwd)} ` +
      `(exists: ${diagnostics.cwdExists})` +
      (diagnostics.shell
        ? `, shell ${diagnostics.shell.source}=${JSON.stringify(diagnostics.shell.selected)} ` +
          `(executable: ${diagnostics.shell.executable})`
        : ""),
  ];
  if (diagnostics.ptyModuleDir) {
    lines.push(`node-pty module: ${diagnostics.ptyModuleDir}`);
    for (const helper of diagnostics.ptyHelpers) {
      lines.push(
        `  ${helper.path}: ${helper.exists ? `mode ${helper.mode ?? "??"}` : "missing"}` +
          (helper.exists ? `, machO ${helper.machOArch ?? "unknown"}` : "") +
          (helper.provenanceHex ? `, com.apple.provenance ${helper.provenanceHex}` : ""),
      );
    }
  }
  // Confirmed failure mode on macOS 26+: npm's node-pty prebuilt helpers carry
  // a downloaded-origin com.apple.provenance xattr; Gatekeeper denies exec
  // with EACCES even though the mode is 0755 and the signature verifies.
  // node-pty collapses that into "posix_spawnp failed." (verified 2026-08-26;
  // see plans/incident-acp-tool-channel-failure.md).
  if (hasDownloadedProvenance(diagnostics)) {
    lines.push(
      "macOS is likely blocking an npm-downloaded spawn-helper (com.apple.provenance). " +
        "Dev: run `bun scripts/fix-node-pty-permissions.ts` (also wired into postinstall). " +
        "Packaged: rebuild with the provenance-resetting afterPack hook.",
    );
  }
  // Secondary confirmed failure mode: prebuilds can also ship without the
  // executable bit, which fails the same way.
  if (diagnostics.ptyHelpers.some((helper) => helper.exists && !helper.executableBit)) {
    lines.push(
      "A node-pty spawn-helper is missing its executable bit. " +
        "Dev: run `bun scripts/fix-node-pty-permissions.ts` (also wired into postinstall). " +
        "Packaged: the afterPack hook restores the bit before signing; reinstall or rebuild the app.",
    );
  }
  return lines.join("\n");
}

function hasDownloadedProvenance(diagnostics: AcpTerminalSpawnDiagnostics): boolean {
  return (
    diagnostics.platform === "darwin" &&
    diagnostics.error.message === "posix_spawnp failed." &&
    diagnostics.ptyHelpers.some(
      (helper) =>
        helper.exists &&
        helper.provenanceHex !== null &&
        !helper.provenanceHex.startsWith(LOCAL_PROVENANCE_PREFIX),
    )
  );
}

export function defaultReadProvenance(path: string): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const output = execFileSync("xattr", ["-px", "com.apple.provenance", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function defaultPtyModuleDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve("node-pty/package.json"));
  } catch {
    return null;
  }
}

// Mirrors node-pty's own helper lookup order (lib/utils.js + unixTerminal.js):
// first existing build directory wins, with the asar-unpacked remap applied.
function ptyHelperCandidates(
  moduleDir: string,
  platform: NodeJS.Platform,
  arch: string,
): Array<{ helperPath: string; ptyNodePath: string }> {
  const dirs = [
    join(moduleDir, "build", "Release"),
    join(moduleDir, "build", "Debug"),
    join(moduleDir, "prebuilds", `${platform}-${arch}`),
  ];
  return dirs.flatMap((dir) => {
    const mapped = dir.includes("app.asar") ? dir.replace("app.asar", "app.asar.unpacked") : dir;
    return [{ helperPath: join(mapped, "spawn-helper"), ptyNodePath: join(mapped, "pty.node") }];
  });
}

function probeHelper(
  candidate: {
    helperPath: string;
    ptyNodePath: string;
  },
  readProvenance: (path: string) => string | null,
): AcpTerminalHelperProbe {
  const probe: AcpTerminalHelperProbe = {
    path: candidate.helperPath,
    exists: false,
    ptyNodeExists: false,
    mode: null,
    executableBit: false,
    machOArch: null,
    provenanceHex: null,
  };
  try {
    probe.ptyNodeExists = existsSync(candidate.ptyNodePath);
    const stats = statSync(candidate.helperPath);
    probe.exists = stats.isFile();
    if (!probe.exists) return probe;
    probe.mode = (stats.mode & 0o777).toString(8).padStart(4, "0");
    probe.executableBit = (stats.mode & 0o111) !== 0;
    probe.machOArch = readMachOArch(candidate.helperPath);
    probe.provenanceHex = readProvenance(candidate.helperPath);
  } catch {
    // Diagnostics must never throw on the error path.
  }
  return probe;
}

// Reads the CPU type out of a Mach-O header (thin or fat) without spawning
// anything; returns null for anything it cannot parse safely.
function readMachOArch(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const header = Buffer.alloc(12);
    if (readSync(fd, header, 0, header.length, 0) < 8) return null;
    const magicLE = header.readUInt32LE(0);
    if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) {
      return machOCpuName(header.readUInt32LE(4));
    }
    if (header.readUInt32BE(0) === 0xcafebabe) {
      const slices = header.readUInt32BE(4);
      if (slices === 0 || slices > 8) return null;
      return `fat:${slices}`;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function machOCpuName(cpuType: number): string | null {
  if (cpuType === 0x0100000c) return "arm64";
  if (cpuType === 0x01000007) return "x86_64";
  if (cpuType === 0x0000000c) return "arm";
  if (cpuType === 0x00000007) return "x86";
  return null;
}

function defaultAppEnvironment(): "dev" | "packaged" {
  if (!process.versions.electron) return "dev";
  return process.defaultApp ? "dev" : "packaged";
}

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
  arch = process.arch,
  appEnvironment = defaultAppEnvironment(),
  ptyModuleDir = defaultPtyModuleDir,
  checkExecutable = defaultCheckExecutable,
  readProvenance = defaultReadProvenance,
}: {
  pty: PtyAdapter;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fallbackShell?: string;
  createId?: () => string;
  arch?: string;
  appEnvironment?: "dev" | "packaged";
  ptyModuleDir?: () => string | null;
  checkExecutable?: (path: string) => boolean;
  readProvenance?: (path: string) => string | null;
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
      const selection = resolveAcpTerminalShell({
        env,
        platform,
        fallbackShell,
        checkExecutable,
      });
      const file = legacyCommand ? selection.shell : request.command;
      const args = legacyCommand
        ? platform === "win32"
          ? ["/d", "/s", "/c", request.command]
          : ["-lc", request.command]
        : request.args!;
      const id = createId();
      if (!id || sessions.has(id)) {
        throw new Error("ACP terminal identity is invalid.");
      }

      let process: PtyProcess;
      try {
        process = pty.spawn(file, args, {
          cwd: workingDirectory,
          cols: 80,
          rows: 24,
          name: launchEnvironment.TERM || "xterm-256color",
          env: launchEnvironment,
        });
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        const moduleDir = ptyModuleDir();
        throw new AcpTerminalSpawnError(
          {
            phase: "pty.spawn",
            platform,
            arch,
            appEnvironment,
            file,
            argCount: args.length,
            legacyCommand,
            cwd: workingDirectory,
            cwdExists: directoryExists(workingDirectory),
            shell: legacyCommand
              ? {
                  selected: selection.shell,
                  source: selection.source,
                  executable: checkExecutable(selection.shell),
                }
              : null,
            // Names only: request env values must never reach logs or the agent.
            requestEnvNames: (request.env ?? []).map((variable) => variable.name),
            ptyModuleDir: moduleDir,
            ptyHelpers: moduleDir
              ? ptyHelperCandidates(moduleDir, platform, arch).map((candidate) =>
                  probeHelper(candidate, readProvenance),
                )
              : [],
            error: {
              name: cause.name,
              message: cause.message,
              code: readErrorCode(cause),
            },
          },
          cause,
        );
      }
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

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readErrorCode(error: Error): string | null {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : null;
}
