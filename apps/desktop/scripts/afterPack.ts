import { chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type AfterPackContext = {
  appOutDir: string;
  electronPlatformName: string;
  packager: { appInfo: { productName: string } };
};

// node-pty's npm prebuilds ship spawn-helper without the executable bit, and
// the build config keeps "npmRebuild": false so CI packages those prebuilds
// instead of compiling node-pty. macOS pty.spawn launches spawn-helper via
// posix_spawnp, which fails with EACCES ("posix_spawnp failed.") unless the
// bit is restored before electron-builder signs the bundle.
export default async function restoreSpawnHelperPermissions(context: AfterPackContext) {
  if (context.electronPlatformName === "win32") return;
  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productName}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const ptyDir = join(resourcesDir, "app.asar.unpacked", "node_modules", "node-pty");
  try {
    makeSpawnHelpersExecutable(ptyDir);
  } catch {
    return;
  }
}

function makeSpawnHelpersExecutable(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) makeSpawnHelpersExecutable(path);
    else if (entry.isFile() && entry.name === "spawn-helper") chmodSync(path, 0o755);
  }
}
