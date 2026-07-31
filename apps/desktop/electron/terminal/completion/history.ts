const MAX_HISTORY_BYTES = 4 * 1024 * 1024;
const MAX_HISTORY_ENTRY_LENGTH = 8 * 1024;

export function parseZshHistory(content: string) {
  const bounded = content.slice(-MAX_HISTORY_BYTES);
  const commands = new Map<string, true>();
  for (const rawLine of bounded.split(/\r?\n/gu)) {
    let command = rawLine;
    if (rawLine.startsWith(": ")) {
      const match = rawLine.match(/^: \d+:\d+;(.*)$/u);
      if (!match) continue;
      command = match[1];
    }
    command = command.trim();
    if (
      !command ||
      command.length > MAX_HISTORY_ENTRY_LENGTH ||
      [...command].some(
        (character) => character.charCodeAt(0) === 0 || character.charCodeAt(0) === 7,
      )
    ) {
      continue;
    }
    commands.delete(command);
    commands.set(command, true);
  }
  return [...commands.keys()];
}

export function predictFromHistory(history: string[], prefix: string) {
  if (!prefix.trim()) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index];
    if (command.startsWith(prefix) && command.length > prefix.length) {
      return { command, suffix: command.slice(prefix.length) };
    }
  }
  return null;
}

export function acceptHistoryPrediction(prefix: string, suffix: string, amount: "all" | "word") {
  if (amount === "all") return prefix + suffix;
  const boundary = suffix.search(/\s/u);
  return prefix + (boundary < 0 ? suffix : suffix.slice(0, boundary + 1));
}

export function createTerminalHistory(initial: string[] = []) {
  const entries = new Map(initial.map((command) => [command, true]));
  return {
    record(command: string) {
      const normalized = command.trim();
      if (!normalized || normalized.length > MAX_HISTORY_ENTRY_LENGTH) return;
      entries.delete(normalized);
      entries.set(normalized, true);
    },
    predict(prefix: string) {
      return predictFromHistory([...entries.keys()], prefix);
    },
  };
}
