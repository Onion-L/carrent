import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

import {
  MAX_TERMINAL_INPUT_BYTES,
  MAX_TERMINAL_TITLE_LENGTH,
  type CreateTerminalRequest,
  type TerminalEvent,
  type TerminalCandidate,
  type TerminalProjectSnapshot,
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
  tab: TerminalTab;
  process: PtyProcess;
  /** Project Working Directory the shell was started in. */
  workingDirectory: string;
  disposed: boolean;
  disposables: Array<{ dispose: () => void }>;
  integration?: ZshShellIntegration;
  completionVersion: number;
  titleCarry: string;
  output: string;
};

type CreateInput = CreateTerminalRequest & { ownerId: number };
type TerminalEventWithoutRevision = TerminalEvent extends infer Event
  ? Event extends { revision: number }
    ? Omit<Event, "revision">
    : never
  : never;

type Dependencies = {
  pty: PtyAdapter;
  emit: (ownerId: number, event: TerminalEvent) => void;
  env?: NodeJS.ProcessEnv;
  fallbackShell?: string;
  /** Login/interactive flags per shell; shells like cmd.exe, dash, and fish accept none. */
  shellArguments?: (shell: string) => string[];
  isExecutable?: (path: string) => boolean;
  isAbsolutePath?: (value: string) => boolean;
  createId?: () => string;
  browserEnvironment?: (input: { projectId: string }) => Record<string, string>;
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

// Only zsh and bash take -l; dash (the usual /bin/sh), fish, and Windows
// shells reject it, so unrecognized shells start without login flags rather
// than failing to spawn at all.
function loginInteractiveArguments(shell: string): string[] {
  return shell.endsWith("/zsh") || shell.endsWith("/bash") ? ["-l", "-i"] : [];
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
  shellArguments = loginInteractiveArguments,
  isExecutable = () => true,
  isAbsolutePath = isAbsolute,
  createId = randomUUID,
  browserEnvironment,
  createShellIntegration,
  complete,
  history,
}: Dependencies) {
  const sessions = new Map<string, Session>();
  const activeByProject = new Map<string, string>();
  const lastTabNumberByProject = new Map<string, number>();
  const subscribersByProject = new Map<string, Set<number>>();
  const revisionByProject = new Map<string, number>();
  const lastFocusVersionByProject = new Map<string, Map<number, number>>();
  const resizeAuthorityByProject = new Map<
    string,
    { ownerId: number; terminalId: string; focusVersion: number }
  >();

  const subscribers = (projectId: string) => {
    let projectSubscribers = subscribersByProject.get(projectId);
    if (!projectSubscribers) {
      projectSubscribers = new Set();
      subscribersByProject.set(projectId, projectSubscribers);
    }
    return projectSubscribers;
  };

  const nextRevision = (projectId: string) => {
    const revision = (revisionByProject.get(projectId) ?? 0) + 1;
    revisionByProject.set(projectId, revision);
    return revision;
  };

  const publish = (projectId: string, event: TerminalEventWithoutRevision) => {
    const value = { ...event, revision: nextRevision(projectId) } as TerminalEvent;
    for (const subscriberId of subscribers(projectId)) emit(subscriberId, value);
  };

  const tabsForProject = (projectId: string) =>
    [...sessions.values()]
      .filter((session) => !session.disposed && session.tab.projectId === projectId)
      .map((session) => ({ ...session.tab }));

  const publishState = (projectId: string) => {
    publish(projectId, { type: "state", projectId, tabs: tabsForProject(projectId) });
  };

  const requireSubscriber = (ownerId: number, projectId: string) => {
    if (!subscribersByProject.get(projectId)?.has(ownerId)) {
      throw new Error("Renderer is not subscribed to this Project's Terminal Tabs.");
    }
  };

  const detachFromProject = (ownerId: number, projectId: string) => {
    subscribersByProject.get(projectId)?.delete(ownerId);
    lastFocusVersionByProject.get(projectId)?.delete(ownerId);
    if (resizeAuthorityByProject.get(projectId)?.ownerId === ownerId) {
      resizeAuthorityByProject.delete(projectId);
    }
  };

  const find = (ownerId: number, projectId: string, terminalId: string) => {
    requireProjectId(projectId);
    requireSubscriber(ownerId, projectId);
    const session = sessions.get(terminalId);
    if (!session || session.disposed || session.tab.projectId !== projectId) {
      throw new Error("Terminal Tab is unavailable.");
    }
    return session;
  };

  const list = (ownerId: number, projectId: string) => {
    requireProjectId(projectId);
    requireSubscriber(ownerId, projectId);
    return tabsForProject(projectId);
  };

  const activate = (ownerId: number, projectId: string, terminalId: string) => {
    find(ownerId, projectId, terminalId);
    activeByProject.set(projectId, terminalId);
    for (const session of sessions.values()) {
      if (session.tab.projectId === projectId && !session.disposed) {
        session.tab.active = session.tab.id === terminalId;
      }
    }
    publishState(projectId);
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
          (candidate) => !candidate.disposed && candidate.tab.projectId === session.tab.projectId,
        )
        .at(-1);
      if (replacement) {
        activeByProject.set(replacement.tab.projectId, replacement.tab.id);
        replacement.tab.active = true;
      } else {
        activeByProject.delete(session.tab.projectId);
        lastTabNumberByProject.delete(session.tab.projectId);
      }
    }
  };

  return {
    subscribe(ownerId: number, projectId: string): TerminalProjectSnapshot {
      requireProjectId(projectId);
      subscribers(projectId).add(ownerId);
      return {
        projectId,
        revision: revisionByProject.get(projectId) ?? 0,
        tabs: tabsForProject(projectId),
        outputByTerminal: Object.fromEntries(
          [...sessions.values()]
            .filter((session) => !session.disposed && session.tab.projectId === projectId)
            .map((session) => [session.tab.id, session.output]),
        ),
      };
    },
    unsubscribe(ownerId: number, projectId: string) {
      requireProjectId(projectId);
      detachFromProject(ownerId, projectId);
    },
    list,
    /**
     * Running Terminal Tabs with the Project Working Directory each one was
     * started in. Exited and closed Tabs are absent; the Worktrees scan uses
     * this to block cleanup of a directory a live shell occupies.
     */
    listRunningTerminalTabs(): Array<{ projectId: string; workingDirectory: string }> {
      return [...sessions.values()]
        .filter((session) => !session.disposed && session.tab.status === "running")
        .map((session) => ({
          projectId: session.tab.projectId,
          workingDirectory: session.workingDirectory,
        }));
    },
    create(input: CreateInput) {
      const projectId = requireProjectId(input.projectId);
      subscribers(projectId).add(input.ownerId);
      if (!isAbsolutePath(input.workingDirectory)) {
        throw new Error("Project Working Directory must be absolute.");
      }
      if (input.ensureFirst) {
        const existing = tabsForProject(projectId);
        const first = existing.find((tab) => tab.active) ?? existing[0];
        if (first) return first;
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
      Object.assign(launchEnvironment, browserEnvironment?.({ projectId }));
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
      const process = pty.spawn(shell, shellArguments(shell), {
        cwd: input.workingDirectory,
        cols: 80,
        rows: 24,
        name: "xterm-256color",
        env: launchEnvironment,
      });
      const session: Session = {
        tab: {
          id,
          projectId,
          title: title || "Terminal",
          active: true,
          status: "running",
          enhancedCompletion: input.enhancedCompletion,
        },
        process,
        workingDirectory: input.workingDirectory,
        disposed: false,
        disposables: [],
        integration,
        completionVersion: 0,
        titleCarry: "",
        output: "",
      };
      sessions.set(id, session);
      activate(input.ownerId, projectId, id);
      session.disposables.push(
        process.onData((data) => {
          if (session.disposed) return;
          const consumed = session.integration?.consume(data) ?? { visible: data, messages: [] };
          if (consumed.visible) {
            session.output += consumed.visible;
            publish(projectId, {
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
              publish(projectId, {
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
                publish(projectId, {
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
            publish(projectId, { type: "title", projectId, terminalId: id, title: nextTitle });
          }
        }),
        process.onExit(({ exitCode, signal }) => {
          if (session.disposed || session.tab.status === "exited") return;
          session.tab.status = "exited";
          publish(projectId, { type: "exit", projectId, terminalId: id, exitCode, signal });
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
    resize(
      ownerId: number,
      projectId: string,
      terminalId: string,
      columns: number,
      rows: number,
      focusVersion: number,
    ) {
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
      const authority = resizeAuthorityByProject.get(projectId);
      if (
        session.tab.status === "running" &&
        authority?.ownerId === ownerId &&
        authority.terminalId === terminalId &&
        authority.focusVersion === focusVersion
      ) {
        session.process.resize(columns, rows);
      }
    },
    focus(
      ownerId: number,
      projectId: string,
      terminalId: string,
      focused: boolean,
      columns: number,
      rows: number,
      focusVersion: number,
    ) {
      const session = find(ownerId, projectId, terminalId);
      if (
        !Number.isInteger(focusVersion) ||
        focusVersion < 1 ||
        !Number.isInteger(columns) ||
        !Number.isInteger(rows) ||
        columns < 2 ||
        columns > 1_000 ||
        rows < 1 ||
        rows > 1_000
      ) {
        throw new Error("Terminal focus is invalid.");
      }
      let versions = lastFocusVersionByProject.get(projectId);
      if (!versions) {
        versions = new Map();
        lastFocusVersionByProject.set(projectId, versions);
      }
      if (focusVersion <= (versions.get(ownerId) ?? 0)) return;
      versions.set(ownerId, focusVersion);
      if (!focused) {
        if (resizeAuthorityByProject.get(projectId)?.ownerId === ownerId) {
          resizeAuthorityByProject.delete(projectId);
        }
        return;
      }
      resizeAuthorityByProject.set(projectId, { ownerId, terminalId, focusVersion });
      if (session.tab.status === "running") session.process.resize(columns, rows);
    },
    activate,
    close(ownerId: number, projectId: string, terminalId: string) {
      requireProjectId(projectId);
      requireSubscriber(ownerId, projectId);
      const session = sessions.get(terminalId);
      if (!session || session.disposed) return;
      if (session.tab.projectId !== projectId) throw new Error("Terminal Tab is unavailable.");
      dispose(session, true);
      publishState(projectId);
    },
    closeProject(projectId: string) {
      requireProjectId(projectId);
      for (const session of sessions.values()) {
        if (session.tab.projectId === projectId) dispose(session, true);
      }
      publishState(projectId);
      resizeAuthorityByProject.delete(projectId);
      lastFocusVersionByProject.delete(projectId);
    },
    detach(ownerId: number) {
      for (const projectId of subscribersByProject.keys()) {
        if (subscribersByProject.get(projectId)?.has(ownerId)) {
          detachFromProject(ownerId, projectId);
        }
      }
    },
    shutdown() {
      for (const session of sessions.values()) dispose(session, true);
    },
  };
}

export type TerminalSessionManager = ReturnType<typeof createTerminalSessionManager>;
