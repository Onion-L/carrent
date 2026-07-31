import type { TerminalCandidate } from "../../../src/shared/terminal";
import type { CommandRule } from "./commandRules";
import { authoredCommandRules } from "./commandRules";
import { importedFigRules } from "./figRules";

export type CompletionCandidate = TerminalCandidate;

export type CompletionInput = {
  commandLine: string;
  cursor: number;
  cwd: string;
  executables: string[];
  builtins: string[];
  aliases: string[];
  functions: string[];
  paths: Array<{ name: string; directory: boolean; prefix?: string }>;
  packageScripts: string[];
  limit?: number;
  rules?: CommandRule[];
};

type Token = { value: string; start: number; end: number };

function tokenize(line: string, cursor: number): Token[] {
  const bounded = line;
  const tokens: Token[] = [];
  let value = "";
  let start = 0;
  let quote: "'" | '"' | null = null;
  let escaping = false;
  let active = false;
  for (let index = 0; index < bounded.length; index += 1) {
    const character = bounded[index];
    if (!active) {
      if (/\s/u.test(character)) continue;
      active = true;
      start = index;
    }
    if (escaping) {
      value += character;
      escaping = false;
    } else if (character === "\\" && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else value += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      tokens.push({ value, start, end: index });
      value = "";
      active = false;
    } else {
      value += character;
    }
  }
  if (active) tokens.push({ value, start, end: bounded.length });

  const boundedCursor = Math.max(0, Math.min(cursor, line.length));
  const currentIndex = tokens.findIndex(
    (token) => boundedCursor >= token.start && boundedCursor <= token.end,
  );
  if (currentIndex >= 0) return tokens.slice(0, currentIndex + 1);
  return [
    ...tokens.filter((token) => token.end < boundedCursor),
    { value: "", start: boundedCursor, end: boundedCursor },
  ];
}

export function getCompletionToken(line: string, cursor: number) {
  return tokenize(line, cursor).at(-1)!;
}

function escapeZshToken(value: string) {
  return value.replace(/([\s\\'"`$&;|<>()[\]{}*?!#~])/gu, "\\$1");
}

function ruleCandidates(
  tokens: Token[],
  rules: CommandRule[],
  packageScripts: string[],
): Array<{ label: string; description?: string; kind: "command" | "option" | "script" }> {
  const commandName = tokens[0]?.value;
  const rootRule = rules.find((candidate) => candidate.name === commandName);
  if (!rootRule || tokens.length === 1) return [];
  let rule: CommandRule = rootRule;
  const completed = tokens.slice(1, -1).map((token) => token.value);
  for (const value of completed) {
    if (value.startsWith("-")) continue;
    const child: CommandRule | undefined = rule.subcommands?.find(
      (candidate) => candidate.name === value,
    );
    if (!child) break;
    rule = child;
  }
  const current = tokens.at(-1)?.value ?? "";
  const present = new Set(completed.filter((value) => value.startsWith("-")));
  const candidates: Array<{
    label: string;
    description?: string;
    kind: "command" | "option" | "script";
  }> = [];
  if (!current.startsWith("-")) {
    for (const child of rule.subcommands ?? []) {
      candidates.push({ label: child.name, description: child.description, kind: "command" });
    }
    if (rule.scripts) {
      for (const script of packageScripts) candidates.push({ label: script, kind: "script" });
    }
  }
  for (const option of rule.options ?? []) {
    if (!option.repeatable && present.has(option.name)) continue;
    candidates.push({ label: option.name, description: option.description, kind: "option" });
  }
  return candidates.filter((candidate) => candidate.label.startsWith(current));
}

export function provideCommandCandidates(input: CompletionInput): CompletionCandidate[] {
  const cursor = Math.max(0, Math.min(input.cursor, input.commandLine.length));
  const tokens = tokenize(input.commandLine, cursor);
  const current = tokens.at(-1)!;
  const candidates: CompletionCandidate[] = [];
  const add = (
    label: string,
    kind: CompletionCandidate["kind"],
    description?: string,
    insertText = label,
  ) => {
    if (!label.startsWith(current.value)) return;
    candidates.push({
      label,
      insertText,
      kind,
      ...(description ? { description: description.slice(0, 240) } : {}),
      replacement: { start: current.start, end: current.end },
    });
  };

  if (tokens.length === 1) {
    for (const value of input.executables) add(value, "executable");
    for (const value of input.builtins) add(value, "builtin");
    for (const value of input.aliases) add(value, "alias");
    for (const value of input.functions) add(value, "function");
  } else {
    for (const candidate of ruleCandidates(
      tokens,
      input.rules ?? [...authoredCommandRules, ...importedFigRules],
      input.packageScripts,
    )) {
      add(candidate.label, candidate.kind, candidate.description);
    }
  }
  if (tokens.length > 1 || current.value.includes("/")) {
    for (const path of input.paths) {
      const label = `${path.prefix ?? ""}${path.name}`;
      const insertText = `${escapeZshToken(label)}${path.directory ? "/" : ""}`;
      add(label, path.directory ? "directory" : "file", undefined, insertText);
    }
  }

  const unique = new Map<string, CompletionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.insertText}\u0000${candidate.replacement.start}\u0000${candidate.replacement.end}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, Math.max(1, Math.min(input.limit ?? 40, 100)));
}
