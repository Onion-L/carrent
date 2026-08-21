/**
 * Shell command tokenization and parsing for the two-track classifier.
 *
 * The tokenizer understands quotes and backslash escapes, and reduces
 * `$VAR` / `${VAR}` / `$(...)` / backticks to opaque tokens whose value
 * cannot be proven statically. Every consumer fails closed: parse errors
 * and unprovable constructs must never be treated as safe.
 */

export type ShellToken =
  | { kind: "word"; value: string }
  | { kind: "opaque" }
  | { kind: "operator"; value: "&&" | "||" | "|" | "&" | ";" | "\n" | "(" | ")" }
  | { kind: "redirect" };

const WHITESPACE = new Set([" ", "\t"]);
const WORD_BREAKS = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")", "<", ">"]);
const REDIRECT_RUN = /^\d{0,2}[<>][<>&|0-9]*/;

/** Skip a single-quoted region starting at `start` (index of the quote). Returns the index after the closing quote, or -1. */
function scanSingleQuoted(input: string, start: number): number {
  const end = input.indexOf("'", start + 1);
  return end === -1 ? -1 : end + 1;
}

/** Skip a backtick substitution starting at `start`. Returns the index after the closing backtick, or -1. */
function scanBackticks(input: string, start: number): number {
  let i = start + 1;
  while (i < input.length) {
    const c = input[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    i += 1;
  }
  return -1;
}

/** Skip a backtick or balanced `$(...)` / `${...}` substitution starting at `i`. Returns `i` unchanged when neither starts there, or -1 on unterminated. */
function scanNested(input: string, i: number): number {
  if (input[i] === "`") return scanBackticks(input, i);
  if (input[i] === "$" && (input[i + 1] === "(" || input[i + 1] === "{")) {
    return scanBalanced(input, i);
  }
  return i;
}

/** Skip a balanced `$(...)` or `${...}` starting at `start` (index of `$`). Returns the index after the closer, or -1. */
function scanBalanced(input: string, start: number): number {
  const open = input[start + 1];
  const close = open === "(" ? ")" : "}";
  let depth = 1;
  let i = start + 2;
  while (i < input.length) {
    const c = input[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      i = scanSingleQuoted(input, i);
      if (i === -1) return -1;
      continue;
    }
    if (c === '"') {
      i = scanDoubleQuoted(input, i);
      if (i === -1) return -1;
      continue;
    }
    const nested = scanNested(input, i);
    if (nested === -1) return -1;
    if (nested !== i) {
      i = nested;
      continue;
    }
    if (c === open) depth += 1;
    if (c === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/** Skip a double-quoted region starting at `start`. Returns the index after the closing quote, or -1. */
function scanDoubleQuoted(input: string, start: number): number {
  let i = start + 1;
  while (i < input.length) {
    const c = input[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return i + 1;
    const nested = scanNested(input, i);
    if (nested === -1) return -1;
    if (nested !== i) {
      i = nested;
      continue;
    }
    i += 1;
  }
  return -1;
}

/**
 * Tokenize a shell command line. Returns null on any parse error
 * (unterminated quote, substitution, or trailing escape) — callers must
 * treat null as unprovable and fail closed.
 */
export function tokenize(input: string): ShellToken[] | null {
  const tokens: ShellToken[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    if (WHITESPACE.has(c)) {
      i += 1;
      continue;
    }
    if (c === "\n") {
      tokens.push({ kind: "operator", value: "\n" });
      i += 1;
      continue;
    }
    if (c === "#") {
      const end = input.indexOf("\n", i);
      i = end === -1 ? input.length : end;
      continue;
    }
    if (c === "&") {
      tokens.push({ kind: "operator", value: input[i + 1] === "&" ? "&&" : "&" });
      i += input[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (c === "|") {
      tokens.push({ kind: "operator", value: input[i + 1] === "|" ? "||" : "|" });
      i += input[i + 1] === "|" ? 2 : 1;
      continue;
    }
    if (c === ";") {
      tokens.push({ kind: "operator", value: ";" });
      i += 1;
      continue;
    }
    if (c === "(" || c === ")") {
      tokens.push({ kind: "operator", value: c });
      i += 1;
      continue;
    }
    const redirect = REDIRECT_RUN.exec(input.slice(i));
    if (redirect) {
      tokens.push({ kind: "redirect" });
      i += redirect[0].length;
      continue;
    }

    // Scan one word.
    let value = "";
    let opaque = false;
    let closed = true;
    while (i < input.length && !WORD_BREAKS.has(input[i])) {
      const w = input[i];
      if (w === "\\") {
        if (i + 1 >= input.length) {
          closed = false;
          break;
        }
        if (input[i + 1] !== "\n") value += input[i + 1];
        i += 2;
        continue;
      }
      if (w === "'") {
        const end = scanSingleQuoted(input, i);
        if (end === -1) {
          closed = false;
          break;
        }
        value += input.slice(i + 1, end - 1);
        i = end;
        continue;
      }
      if (w === '"') {
        const end = scanDoubleQuoted(input, i);
        if (end === -1) {
          closed = false;
          break;
        }
        const inner = input.slice(i + 1, end - 1);
        if (/[$`]/.test(inner)) {
          opaque = true;
        } else {
          value += inner.replace(/\\([$`"\\])/g, "$1");
        }
        i = end;
        continue;
      }
      if (w === "`") {
        const end = scanBackticks(input, i);
        if (end === -1) {
          closed = false;
          break;
        }
        opaque = true;
        i = end;
        continue;
      }
      if (w === "$") {
        const next = input[i + 1];
        if (next === "(" || next === "{") {
          const end = scanBalanced(input, i);
          if (end === -1) {
            closed = false;
            break;
          }
          opaque = true;
          i = end;
          continue;
        }
        if (next && /[A-Za-z0-9_@*#?$!-]/.test(next)) {
          let j = i + 1;
          if (/[A-Za-z_]/.test(next)) {
            while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j += 1;
          } else {
            j += 1;
          }
          opaque = true;
          i = j;
          continue;
        }
        value += w;
        i += 1;
        continue;
      }
      value += w;
      i += 1;
    }
    if (!closed) return null;
    tokens.push(opaque ? { kind: "opaque" } : { kind: "word", value });
  }

  return tokens;
}

const MAX_WRAPPER_DEPTH = 8;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const OPTION_TOKEN = /^-/;
/** `bash`/`sh` flags whose next argument is an executable string: `-c` and bundles like `-lc`. */
const COMMAND_STRING_FLAG = /^-[a-z]*c$/i;

/** Split a token stream into segments at every operator; for the loose track every operator separates command positions. */
function splitLooseSegments(tokens: ShellToken[]): ShellToken[][] {
  const segments: ShellToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "operator") {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(token);
    }
  }
  return segments.filter((segment) => segment.length > 0);
}

/** Convert a segment to argv: words keep their value, opaque tokens become "", redirects and their targets are dropped. */
function segmentToArgv(segment: ShellToken[]): string[] {
  const argv: string[] = [];
  for (let i = 0; i < segment.length; i += 1) {
    const token = segment[i];
    if (token.kind === "redirect") {
      i += 1; // drop the redirect target as well
      continue;
    }
    argv.push(token.kind === "word" ? token.value : "");
  }
  return argv;
}

function stripLeadingAssignments(argv: string[]): string[] {
  let start = 0;
  while (start < argv.length && ASSIGNMENT.test(argv[start])) start += 1;
  return argv.slice(start);
}

function collectInput(input: string, depth: number, out: string[][]): boolean {
  const tokens = tokenize(input);
  if (tokens === null) return false;
  for (const segment of splitLooseSegments(tokens)) {
    if (!collectArgv(segmentToArgv(segment), depth, out)) return false;
  }
  return true;
}

function collectArgv(argv: string[], depth: number, out: string[][]): boolean {
  if (depth > MAX_WRAPPER_DEPTH) return false;
  const command = stripLeadingAssignments(argv);
  if (command.length === 0) return true;
  out.push(command);

  const head = command[0].toLowerCase();
  if (head === "sudo" || head === "env" || head === "nohup" || head === "xargs") {
    // Wrapper options can take separate values (`xargs -n 1 rm`, `env -u FOO rm`)
    // and the set of value-taking flags varies by platform, so every non-option
    // suffix is a candidate command position — loose, like the regex it replaces.
    for (let start = 1; start < command.length; start += 1) {
      const token = command[start];
      if (OPTION_TOKEN.test(token)) continue;
      if (head === "env" && ASSIGNMENT.test(token)) continue;
      if (!collectArgv(command.slice(start), depth + 1, out)) return false;
    }
    return true;
  }
  if (head === "bash" || head === "sh") {
    const flagIndex = command.findIndex(
      (token, index) => index > 0 && COMMAND_STRING_FLAG.test(token),
    );
    const payload = flagIndex > 0 ? command[flagIndex + 1] : undefined;
    if (payload) return collectInput(payload, depth + 1, out);
    return true;
  }
  if (head === "trap") {
    const action = command[1];
    if (action) return collectInput(action, depth + 1, out);
    return true;
  }
  return true;
}

/**
 * Loose danger extractor: returns the argv of every command position in
 * `input`, descending into executable-string wrappers (`bash -c`, `sh -c`,
 * `xargs`, `trap`, and the command after `sudo` / `env` / `nohup`). Plain
 * string arguments are never command positions. Returns null on parse
 * error or past the wrapper depth cap — callers must fail closed.
 */
export function findCommandWords(input: string): string[][] | null {
  const out: string[][] = [];
  if (!collectInput(input, 0, out)) return null;
  return out;
}

const UNPROVABLE_WORD = /[*?[\]~]/;

/**
 * Strict safe parser: splits `input` into per-segment argv, but only when
 * every token is a pure literal. Opaque tokens, globs, `~`, redirects,
 * background operators, subshell parentheses, and leading environment
 * assignments all make the command unprovable and yield null. This track
 * can only ever prove safety.
 */
export function parseSegments(input: string): string[][] | null {
  const tokens = tokenize(input);
  if (tokens === null) return null;

  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "operator") {
      if (token.value === "&" || token.value === "(" || token.value === ")") return null;
      segments.push([]);
      continue;
    }
    if (token.kind !== "word") return null;
    segments[segments.length - 1].push(token.value);
  }

  // A single trailing separator (`echo hi;`) is harmless; any other empty segment is a syntax error.
  if (segments.length > 1 && segments[segments.length - 1].length === 0) segments.pop();

  for (const segment of segments) {
    if (segment.length === 0) return null;
    if (ASSIGNMENT.test(segment[0])) return null;
    if (segment.some((word) => UNPROVABLE_WORD.test(word))) return null;
  }
  return segments;
}
