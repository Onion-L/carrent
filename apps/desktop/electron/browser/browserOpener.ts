import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function installBrowserOpener(userDataPath: string, runtimePath = process.execPath) {
  const scriptPath = join(userDataPath, "carrent-browser-opener.cjs");
  const launcherPath = join(userDataPath, "carrent-browser-opener");
  writeFileSync(
    scriptPath,
    `const { spawn } = require("node:child_process");
const token = process.env.CARRENT_BROWSER_TOKEN;
const value = process.argv.at(-1);
if (!token || !value) process.exit(1);
let url;
try { url = new URL(value); } catch { process.exit(1); }
if (url.protocol !== "http:" && url.protocol !== "https:") process.exit(1);
const target = new URL("carrent://browser/open");
target.searchParams.set("token", token);
target.searchParams.set("url", url.toString());
const child = spawn("/usr/bin/open", [target.toString()], { detached: true, stdio: "ignore" });
child.unref();
`,
    "utf8",
  );
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
