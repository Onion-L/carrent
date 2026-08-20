import os from "node:os";

// Packaged macOS/Linux apps launch from a desktop session (launchd, .desktop)
// whose PATH is minimal ("/usr/bin:/bin:...") and misses user-level CLI install
// dirs. CLI detection and child processes inherit process.env.PATH, so we
// prepend the well-known install locations once at startup.
const EXTRA_CLI_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  `${os.homedir()}/.local/bin`,
  `${os.homedir()}/.bun/bin`,
];

export function ensureCliPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "win32") return;

  const existingPath = env.PATH ?? "";
  env.PATH = [...EXTRA_CLI_PATHS, existingPath].filter(Boolean).join(":");
}
