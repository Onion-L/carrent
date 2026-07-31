import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  getCompletionToken,
  provideCommandCandidates,
  type CompletionCandidate,
} from "./completionEngine";

type DirectoryEntry = { name: string; directory: boolean };

type CompletionState = {
  commandLine: string;
  cursor: number;
  cwd: string;
  path: string;
  aliases: string[];
  functions: string[];
};

type Dependencies = {
  readDirectory?: (path: string) => Promise<DirectoryEntry[]>;
  readTextFile?: (path: string) => Promise<string>;
};

const ZSH_BUILTINS = [
  "alias",
  "autoload",
  "bg",
  "bindkey",
  "builtin",
  "cd",
  "command",
  "dirs",
  "disown",
  "echo",
  "eval",
  "exec",
  "exit",
  "export",
  "false",
  "fc",
  "fg",
  "functions",
  "getopts",
  "hash",
  "history",
  "jobs",
  "kill",
  "popd",
  "print",
  "printf",
  "pushd",
  "pwd",
  "read",
  "set",
  "source",
  "test",
  "true",
  "type",
  "typeset",
  "ulimit",
  "umask",
  "unalias",
  "unset",
  "wait",
  "whence",
  "where",
  "which",
];

async function defaultReadDirectory(path: string): Promise<DirectoryEntry[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .slice(0, 2_000)
    .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
}

async function defaultReadTextFile(path: string) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 256 * 1024)
    throw new Error("Package manifest is too large.");
  return readFile(path, "utf8");
}

async function safely<T>(operation: () => Promise<T>, fallback: T) {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}

function parsePackageScripts(content: string) {
  if (Buffer.byteLength(content) > 256 * 1024) return [];
  try {
    const parsed = JSON.parse(content) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) {
      return [];
    }
    return Object.keys(parsed.scripts)
      .filter((name) => name.length > 0 && name.length <= 200)
      .slice(0, 500);
  } catch {
    return [];
  }
}

export function createTerminalCompletionService({
  readDirectory = defaultReadDirectory,
  readTextFile = defaultReadTextFile,
}: Dependencies = {}) {
  return {
    async complete(state: CompletionState): Promise<CompletionCandidate[]> {
      if (
        !state.cwd.startsWith("/") ||
        state.commandLine.length > 8_192 ||
        state.cursor < 0 ||
        state.cursor > state.commandLine.length
      ) {
        return [];
      }
      const pathDirectories = state.path
        .split(":")
        .filter((value) => value.startsWith("/"))
        .slice(0, 100);
      const executableLists = await Promise.all(
        pathDirectories.map((directory) => safely(() => readDirectory(directory), [])),
      );
      const executables = executableLists.flatMap((entries) =>
        entries.filter((entry) => !entry.directory).map((entry) => entry.name),
      );
      const token = getCompletionToken(state.commandLine, state.cursor);
      const slash = token.value.lastIndexOf("/");
      const pathPrefix = slash >= 0 ? token.value.slice(0, slash + 1) : "";
      const pathDirectory = pathPrefix ? resolve(state.cwd, pathPrefix) : state.cwd;
      const paths = (await safely(() => readDirectory(pathDirectory), [])).map((entry) => ({
        ...entry,
        ...(pathPrefix ? { prefix: pathPrefix } : {}),
      }));
      const manifest = await safely(() => readTextFile(join(state.cwd, "package.json")), "");
      return provideCommandCandidates({
        commandLine: state.commandLine,
        cursor: state.cursor,
        cwd: state.cwd,
        executables,
        builtins: ZSH_BUILTINS,
        aliases: state.aliases,
        functions: state.functions,
        paths,
        packageScripts: parsePackageScripts(manifest),
      });
    },
  };
}

export type TerminalCompletionService = ReturnType<typeof createTerminalCompletionService>;
