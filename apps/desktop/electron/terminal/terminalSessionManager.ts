import { randomUUID } from "node:crypto";

import {
  MAX_TERMINAL_INPUT_BYTES,
  MAX_TERMINAL_TITLE_LENGTH,
  type CreateTerminalRequest,
  type TerminalEvent,
  type TerminalCandidate,
  type TerminalTab,
} from "../../src/shared/terminal";
import type { ZshShellIntegration } from "./completion/shellIntegration";

export type PtyProcess = {
  onData: (listener: (data: string) => void) => { dispose: () => void };
  onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
    dispose: () => void;
  };
  write: (data: string) => void;
  resize: (columns: number, rows: number) => void;
  kill: () => void;
};

export type PtyAdapter = {
  spawn: (
    file: string,
    args: string[],
    options: {
      cwd: string;
      cols: number;
      rows: number;
      name: string;
      env: Record<string, string>;
    },
  ) => PtyProcess;
};

type Session = {
  ownerId: number;
  tab: TerminalTab;
  process: PtyProcess;
  disposed: boolean;
  disposables: Array<{ dispose: () => void }>;
  integration?: ZshShellIntegration;
  completionVersion: number;
  titleCarry: string;
};

type CreateInput = CreateTerminalRequest & { ownerId: number };

type Dependencies = {
  pty: PtyAdapter;
  emit: (ownerId: number, event: TerminalEvent) => void;
  env?: NodeJS.ProcessEnv;
  fallbackShell?: string;
  isExecutable?: (path: string) => boolean;
  createId?: () => string;
  createShellIntegration?: (input: {
    homeDirectory: string;
    originalZdotdir?: string;
    token: string;
  }) => ZshShellIntegration;
  complete?: (input: {
    commandLine: string;
    cursor: number;
    cwd: string;
    path: string;
    aliases: string[];
    functions: string[];
  }) => Promise<TerminalCandidate[]>;
  history?: {
    record: (command: string) => void;
    predict: (prefix: string) => { suffix: string } | null;
  };
};

const PROJECT_ID_PATTERN = /^[\w.-]{1,200}$/u;
const OSC_PREFIX = "\u001b]";
const OSC_BELL = "\u0007";
const OSC_STRING_TERMINATOR = "\u001b\\";

function requireProjectId(projectId: string) {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid Project identity.");
  return projectId;
}

function sanitizeTitle(title: string) {
  const clean = [...title]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return clean.slice(0, MAX_TERMINAL_TITLE_LENGTH);
}

function readOscTitles(value: string) {
  const titles: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(OSC_PREFIX, cursor);
    if (start < 0) break;
    const commandEnd = value.indexOf(";", start + OSC_PREFIX.length);
    if (commandEnd < 0) {
      const carry = value.slice(start);
      return {
        titles,
        carry: Buffer.byteLength(carry) <= OSC_PREFIX.length + 2 ? carry : "",
      };
    }
    const command = value.slice(start + OSC_PREFIX.length, commandEnd);
    if (command !== "0" && command !== "2") {
      cursor = commandEnd + 1;
      continue;
    }
    const bellEnd = value.indexOf(OSC_BELL, commandEnd + 1);
    const stringEnd = value.indexOf(OSC_STRING_TERMINATOR, commandEnd + 1);
    const end = bellEnd < 0 ? stringEnd : stringEnd < 0 ? bellEnd : Math.min(bellEnd, stringEnd);
    if (end < 0) {
      const carry = value.slice(start);
      return {
        titles,
        carry: Buffer.byteLength(carry) <= MAX_TERMINAL_TITLE_LENGTH * 4 ? carry : "",
      };
    }
    titles.push(value.slice(commandEnd + 1, end));
    cursor = end + (end === stringEnd ? OSC_STRING_TERMINATOR.length : OSC_BELL.length);
  }
  const partialPrefixes = [`${OSC_PREFIX}0;`, `${OSC_PREFIX}2;`];
  const carry = partialPrefixes
    .flatMap((prefix) =>
      [...prefix]
        .map((_, index) => prefix.slice(0, index + 1))
        .filter((part) => value.endsWith(part)),
    )
    .sort((left, right) => right.length - left.length)[0];
  return { titles, carry: carry ?? "" };
}

function terminalEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && !key.startsWith("ELECTRON_RUN_AS_NODE")) result[key] = value;
  }
  result.TERM = "xterm-256color";
  result.COLORTERM = "truecolor";
  result.TERM_PROGRAM = "Carrent";
  return result;
}

export function createTerminalSessionManager({
  pty,
  emit,
  env = process.env,
  fallbackShell = "/bin/zsh",
  isExecutable = () => true,
  createId = randomUUID,
  createShellIntegration,
  complete,
  history,
}: Dependencies) {
  const sessions = new Map<string, Session>();
  const activeByProject = new Map<string, string>();
  const lastTabNumberByProject = new Map<string, number>();

  const find = (ownerId: number, projectId: string, terminalId: string) => {
    requireProjectId(projectId);
    const session = sessions.get(terminalId);
    if (
      !session ||
      session.disposed ||
      session.ownerId !== ownerId ||
      session.tab.projectId !== projectId
    ) {
      throw new Error("Terminal Tab is unavailable.");
    }
    return session;
  };

  const list = (ownerId: number, projectId: string) => {
    requireProjectId(projectId);
    return [...sessions.values()]
      .filter(
        (session) =>
          !session.disposed && session.ownerId === ownerId && session.tab.projectId === projectId,
      )
      .map((session) => ({ ...session.tab }));
  };

  const activate = (ownerId: number, projectId: string, terminalId: string) => {
    find(ownerId, projectId, terminalId);
    activeByProject.set(projectId, terminalId);
    for (const session of sessions.values()) {
      if (session.ownerId === ownerId && session.tab.projectId === projectId && !session.disposed) {
        session.tab.active = session.tab.id === terminalId;
      }
    }
  };

  const dispose = (session: Session, kill: boolean) => {
    if (session.disposed) return;
    session.disposed = true;
    for (const disposable of session.disposables) disposable.dispose();
    session.integration?.dispose();
    if (kill && session.tab.status === "running") session.process.kill();
    sessions.delete(session.tab.id);
    if (activeByProject.get(session.tab.projectId) === session.tab.id) {
      const replacement = [...sessions.values()]
        .filter(
          (candidate) =>
            !candidate.disposed &&
            candidate.ownerId === session.ownerId &&
            candidate.tab.projectId === session.tab.projectId,
        )
        .at(-1);
      if (replacement) activate(replacement.ownerId, replacement.tab.projectId, replacement.tab.id);
      else {
        activeByProject.delete(session.tab.projectId);
        lastTabNumberByProject.delete(session.tab.projectId);
      }
    }
  };

  return {
    list,
    create(input: CreateInput) {
      const projectId = requireProjectId(input.projectId);
      if (!input.workingDirectory.startsWith("/")) {
        throw new Error("Project Working Directory must be absolute.");
      }
      const shell =
        typeof env.SHELL === "string" && env.SHELL.startsWith("/") && isExecutable(env.SHELL)
          ? env.SHELL
          : fallbackShell;
      const existingCount = list(input.ownerId, projectId).length;
      const tabNumber = existingCount === 0 ? 1 : (lastTabNumberByProject.get(projectId) ?? 1) + 1;
      lastTabNumberByProject.set(projectId, tabNumber);
      const id = createId();
      const title = sanitizeTitle(
        tabNumber === 1 ? input.projectName : `${input.projectName} ${tabNumber}`,
      );
      const launchEnvironment = terminalEnvironment(env);
      let integration: ZshShellIntegration | undefined;
      if (input.enhancedCompletion && shell.endsWith("/zsh") && createShellIntegration) {
        try {
          integration = createShellIntegration({
            homeDirectory: env.HOME ?? "",
            ...(env.ZDOTDIR ? { originalZdotdir: env.ZDOTDIR } : {}),
            token: randomUUID().replaceAll("-", ""),
          });
          launchEnvironment.ZDOTDIR = integration.zdotdir;
        } catch {
          integration = undefined;
        }
      }
      const process = pty.spawn(shell, ["-l", "-i"], {
        cwd: input.workingDirectory,
        cols: 80,
        rows: 24,
        name: "xterm-256color",
        env: launchEnvironment,
      });
      const session: Session = {
        ownerId: input.ownerId,
        tab: {
          id,
          projectId,
          title: title || "Terminal",
          active: true,
          status: "running",
          enhancedCompletion: input.enhancedCompletion,
        },
        process,
        disposed: false,
        disposables: [],
        integration,
        completionVersion: 0,
        titleCarry: "",
      };
      sessions.set(id, session);
      activate(input.ownerId, projectId, id);
      session.disposables.push(
        process.onData((data) => {
          if (session.disposed) return;
          const consumed = session.integration?.consume(data) ?? { visible: data, messages: [] };
          if (consumed.visible) {
            emit(input.ownerId, {
              type: "output",
              projectId,
              terminalId: id,
              data: consumed.visible,
            });
          }
          for (const message of consumed.messages) {
            if (message.type === "command") {
              history?.record(message.command);
              session.completionVersion += 1;
              emit(input.ownerId, {
                type: "completion",
                projectId,
                terminalId: id,
                commandLine: "",
                cursor: 0,
                predictionSuffix: "",
                candidates: [],
              });
            } else {
              session.completionVersion += 1;
              const version = session.completionVersion;
              const predictionSuffix =
                message.cursor === message.commandLine.length
                  ? (history?.predict(message.commandLine)?.suffix ?? "")
                  : "";
              void (
                complete?.({
                  commandLine: message.commandLine,
                  cursor: message.cursor,
                  cwd: message.cwd,
                  path: message.path,
                  aliases: message.aliases,
                  functions: message.functions,
                }) ?? Promise.resolve([])
              ).then((candidates) => {
                if (session.disposed || session.completionVersion !== version) return;
                emit(input.ownerId, {
                  type: "completion",
                  projectId,
                  terminalId: id,
                  commandLine: message.commandLine,
                  cursor: message.cursor,
                  predictionSuffix,
                  candidates,
                });
              });
            }
          }
          const parsedTitles = readOscTitles(session.titleCarry + consumed.visible);
          session.titleCarry = parsedTitles.carry;
          for (const title of parsedTitles.titles) {
            const nextTitle = sanitizeTitle(title);
            if (!nextTitle) continue;
            session.tab.title = nextTitle;
            emit(input.ownerId, { type: "title", projectId, terminalId: id, title: nextTitle });
          }
        }),
        process.onExit(({ exitCode, signal }) => {
          if (session.disposed || session.tab.status === "exited") return;
          session.tab.status = "exited";
          emit(input.ownerId, { type: "exit", projectId, terminalId: id, exitCode, signal });
        }),
      );
      return { ...session.tab };
    },
    write(ownerId: number, projectId: string, terminalId: string, data: string) {
      if (typeof data !== "string" || Buffer.byteLength(data) > MAX_TERMINAL_INPUT_BYTES) {
        throw new Error("Terminal input is invalid or too large.");
      }
      const session = find(ownerId, projectId, terminalId);
      if (session.tab.status !== "running") throw new Error("Terminal Tab has exited.");
      session.process.write(data);
    },
    resize(ownerId: number, projectId: string, terminalId: string, columns: number, rows: number) {
      if (
        !Number.isInteger(columns) ||
        !Number.isInteger(rows) ||
        columns < 2 ||
        columns > 1_000 ||
        rows < 1 ||
        rows > 1_000
      ) {
        throw new Error("Terminal dimensions are invalid.");
      }
      const session = find(ownerId, projectId, terminalId);
      if (session.tab.status === "running") session.process.resize(columns, rows);
    },
    activate,
    close(ownerId: number, projectId: string, terminalId: string) {
      dispose(find(ownerId, projectId, terminalId), true);
    },
    closeProject(projectId: string) {
      requireProjectId(projectId);
      for (const session of sessions.values()) {
        if (session.tab.projectId === projectId) dispose(session, true);
      }
    },
    closeOwner(ownerId: number) {
      for (const session of sessions.values()) {
        if (session.ownerId === ownerId) dispose(session, true);
      }
    },
    shutdown() {
      for (const session of sessions.values()) dispose(session, true);
    },
  };
}

export type TerminalSessionManager = ReturnType<typeof createTerminalSessionManager>;
