export interface CommandLaunch {
  command: string;
  args: string[];
}

export interface CommandLaunchOptions {
  platform?: NodeJS.Platform;
  env?: { COMSPEC?: string | undefined };
}

// Windows cannot exec npm's .cmd/.bat CLI shims directly: CreateProcess only
// resolves .exe. Bare CLI names and batch files are routed through cmd.exe,
// whose PATH + PATHEXT lookup resolves CLI shims the way a shell would.
// `shell: true` is deliberately avoided — Node 24 deprecates it with
// args and it never escaped them.
//
// Callers must pass arguments without cmd.exe metacharacters (space-free
// flags are always safe); Node quotes spaced arguments, but cmd re-parses
// the tail, so unquoted & | < > ^ % would not survive.
export function resolveCommandLaunch(
  command: string,
  args: readonly string[],
  options: CommandLaunchOptions = {},
): CommandLaunch {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== "win32" || isNativeExecutable(command)) {
    return { command, args: [...args] };
  }
  return {
    command: env.COMSPEC || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  };
}

function isNativeExecutable(command: string) {
  const lower = command.toLowerCase();
  return lower.endsWith(".exe") || lower.endsWith(".com");
}
