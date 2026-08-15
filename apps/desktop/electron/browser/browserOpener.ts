import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function openCommandSource(platform: NodeJS.Platform) {
  if (platform === "win32") {
    return `spawn((process.env.SystemRoot || process.env.WINDIR || "C:\\\\Windows") + "\\\\explorer.exe", [target.toString()], { detached: true, stdio: "ignore", windowsHide: true, env: openEnvironment })`;
  }
  const openCommand = platform === "darwin" ? "/usr/bin/open" : "xdg-open";
  return `spawn("${openCommand}", [target.toString()], { detached: true, stdio: "ignore", env: openEnvironment })`;
}

export function installBrowserOpener(
  userDataPath: string,
  runtimePath = process.execPath,
  platform: NodeJS.Platform = process.platform,
) {
  const scriptPath = join(userDataPath, "carrent-browser-opener.cjs");
  const script = `const { spawn } = require("node:child_process");
const token = process.env.CARRENT_BROWSER_TOKEN;
const value = process.argv.at(-1);
if (!token || !value) process.exit(1);
let url;
try { url = new URL(value); } catch { process.exit(1); }
if (url.protocol !== "http:" && url.protocol !== "https:") process.exit(1);
const target = new URL("carrent://browser/open");
target.searchParams.set("token", token);
target.searchParams.set("url", url.toString());
const openEnvironment = { ...process.env };
delete openEnvironment.ELECTRON_RUN_AS_NODE;
const child = ${openCommandSource(platform)};
child.unref();
`;

  if (platform === "win32") {
    // Windows has no shebang execution; agents invoke the BROWSER command
    // through cmd.exe, which only runs batch launchers.
    const launcherPath = join(userDataPath, "carrent-browser-opener.cmd");
    writeFileSync(
      launcherPath,
      `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${runtimePath}" "${scriptPath}" %*\r\n`,
      "utf8",
    );
    writeFileSync(scriptPath, script, "utf8");
    return launcherPath;
  }

  const launcherPath = join(userDataPath, "carrent-browser-opener");
  writeFileSync(scriptPath, script, "utf8");
  writeFileSync(
    launcherPath,
    `#!/bin/sh
export ELECTRON_RUN_AS_NODE=1
exec ${shellQuote(runtimePath)} ${shellQuote(scriptPath)} "$@"
`,
    "utf8",
  );
  chmodSync(launcherPath, 0o700);
  return launcherPath;
}
