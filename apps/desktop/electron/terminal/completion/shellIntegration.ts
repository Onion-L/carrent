import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROTOCOL_PREFIX = "\u001b]633;Carrent;";
const PROTOCOL_END = "\u0007";
const MAX_PROTOCOL_BYTES = 32 * 1024;
const MAX_COMMAND_LINE_BYTES = 8 * 1024;

export type ShellIntegrationMessage =
  | {
      type: "state";
      cursor: number;
      cwd: string;
      commandLine: string;
      path: string;
      aliases: string[];
      functions: string[];
    }
  | { type: "command"; command: string };

function quoteDouble(value: string) {
  return value.replace(/[\\"`$]/gu, "\\$&");
}

function sourceFile(originalZdotdir: string, name: string) {
  const path = quoteDouble(join(originalZdotdir, name));
  return `[[ -r "${path}" ]] && source "${path}"\n`;
}

function decode(value: string, maxBytes: number) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length > maxBytes * 2) return null;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return Buffer.byteLength(decoded) <= maxBytes && !decoded.includes("\u0000") ? decoded : null;
}

export function createZshShellIntegration({
  baseDirectory = tmpdir(),
  homeDirectory,
  originalZdotdir = homeDirectory,
  token,
}: {
  baseDirectory?: string;
  homeDirectory: string;
  originalZdotdir?: string;
  token: string;
}) {
  mkdirSync(baseDirectory, { recursive: true });
  const zdotdir = mkdtempSync(join(baseDirectory, "carrent-zsh-"));
  for (const name of [".zshenv", ".zprofile", ".zlogin"]) {
    const restoreIntegrationDirectory =
      name === ".zshenv" ? `export ZDOTDIR="${quoteDouble(zdotdir)}"\n` : "";
    writeFileSync(
      join(zdotdir, name),
      `${sourceFile(originalZdotdir, name)}${restoreIntegrationDirectory}`,
      { mode: 0o600 },
    );
  }
  const safeToken = token.replace(/[^A-Za-z0-9_-]/gu, "");
  const zshrc = `${sourceFile(originalZdotdir, ".zshrc")}
zmodload zsh/zle
autoload -Uz add-zle-hook-widget add-zsh-hook
_carrent_b64() { printf %s "$1" | base64 | tr -d '\\n' }
_carrent_report_state() {
  (( \${#BUFFER} <= ${MAX_COMMAND_LINE_BYTES} )) || return
  local encoded_buffer="$(_carrent_b64 "$BUFFER")"
  local encoded_pwd="$(_carrent_b64 "$PWD")"
  local encoded_path="$(_carrent_b64 "$PATH")"
  local alias_names="\${(j:,:)\${(k)aliases}}"
  local function_names="\${(j:,:)\${(k)functions}}"
  printf '\\e]633;Carrent;${safeToken};state;%d;%s;%s;%s;%s;%s\\a' "$CURSOR" "$encoded_pwd" "$encoded_buffer" "$encoded_path" "$alias_names" "$function_names"
}
_carrent_report_command() {
  local encoded_command="$(_carrent_b64 "$1")"
  printf '\\e]633;Carrent;${safeToken};command;%s\\a' "$encoded_command"
}
add-zle-hook-widget line-init _carrent_report_state
add-zle-hook-widget line-pre-redraw _carrent_report_state
add-zsh-hook preexec _carrent_report_command
`;
  writeFileSync(join(zdotdir, ".zshrc"), zshrc, { mode: 0o600 });

  let carry = "";
  return {
    zdotdir,
    consume(data: string): { visible: string; messages: ShellIntegrationMessage[] } {
      let value = carry + data;
      carry = "";
      const partialStart = value.lastIndexOf(PROTOCOL_PREFIX);
      if (partialStart >= 0 && value.indexOf(PROTOCOL_END, partialStart) < 0) {
        carry = value.slice(partialStart);
        value = value.slice(0, partialStart);
        if (Buffer.byteLength(carry) > MAX_PROTOCOL_BYTES) {
          value += carry;
          carry = "";
        }
      }
      const messages: ShellIntegrationMessage[] = [];
      const consumePayload = (payload: string) => {
        const fields = payload.split(";");
        if (fields[0] !== safeToken) return false;
        if (fields[1] === "command" && fields.length === 3) {
          const command = decode(fields[2], MAX_COMMAND_LINE_BYTES);
          if (!command) return false;
          messages.push({ type: "command", command });
          return true;
        }
        if (fields[1] !== "state" || fields.length !== 8) return false;
        const cursor = Number(fields[2]);
        const cwd = decode(fields[3], 4_096);
        const commandLine = decode(fields[4], MAX_COMMAND_LINE_BYTES);
        const path = decode(fields[5], 16_384);
        if (
          !Number.isInteger(cursor) ||
          cursor < 0 ||
          !cwd?.startsWith("/") ||
          commandLine == null ||
          path == null ||
          cursor > commandLine.length
        ) {
          return false;
        }
        const names = (field: string) =>
          field
            .split(",")
            .filter((name) => /^[\w.+:@%-]{1,100}$/u.test(name))
            .slice(0, 500);
        messages.push({
          type: "state",
          cursor,
          cwd,
          commandLine,
          path,
          aliases: names(fields[6]),
          functions: names(fields[7]),
        });
        return true;
      };
      let visible = "";
      let cursor = 0;
      while (cursor < value.length) {
        const start = value.indexOf(PROTOCOL_PREFIX, cursor);
        if (start < 0) {
          visible += value.slice(cursor);
          break;
        }
        visible += value.slice(cursor, start);
        const end = value.indexOf(PROTOCOL_END, start + PROTOCOL_PREFIX.length);
        if (end < 0) {
          visible += value.slice(start);
          break;
        }
        const sequence = value.slice(start, end + PROTOCOL_END.length);
        const payload = value.slice(start + PROTOCOL_PREFIX.length, end);
        if (!consumePayload(payload)) visible += sequence;
        cursor = end + PROTOCOL_END.length;
      }
      return { visible, messages };
    },
    dispose() {
      rmSync(zdotdir, { recursive: true, force: true });
    },
  };
}

export type ZshShellIntegration = ReturnType<typeof createZshShellIntegration>;
