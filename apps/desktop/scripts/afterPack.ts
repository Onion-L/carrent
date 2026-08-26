import { chmodSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
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
//
// The same prebuilds also carry a downloaded-origin com.apple.provenance
// xattr. On macOS 26+ Gatekeeper denies exec of those binaries with EACCES
// even at mode 0755 with a valid signature, and the xattr cannot be deleted
// (verified 2026-08-26; plans/incident-acp-tool-channel-failure.md). The
// helper files are rewritten through a fresh inode before signing, which
// resets provenance to build-machine-local and unblocks exec on end-user
// machines. scripts/fix-node-pty-permissions.ts does the same for dev.
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
    else if (entry.isFile() && entry.name === "spawn-helper") {
      resetProvenanceByRewrite(path);
      chmodSync(path, 0o755);
    }
  }
}

function resetProvenanceByRewrite(path: string) {
  if (process.platform !== "darwin") return;
  const contents = readFileSync(path);
  const temp = join(path + `.reset-${process.pid}`);
  writeFileSync(temp, contents, { mode: 0o755 });
  renameSync(temp, path);
}
