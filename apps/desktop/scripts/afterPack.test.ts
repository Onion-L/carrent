import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import restoreSpawnHelperPermissions, { type AfterPackContext } from "./afterPack";

function packagedApp(root: string, platform: "darwin" | "win32") {
  const appOutDir = join(root, platform === "darwin" ? "mac-arm64" : "win-unpacked");
  const resourcesDir =
    platform === "darwin"
      ? join(appOutDir, "Carrent.app", "Contents", "Resources")
      : join(appOutDir, "resources");
  const ptyDir = join(resourcesDir, "app.asar.unpacked", "node_modules", "node-pty");
  const context: AfterPackContext = {
    appOutDir,
    electronPlatformName: platform,
    packager: { appInfo: { productName: "Carrent" } },
  };
  return {
    context,
    file: (relative: string) => {
      const path = join(ptyDir, relative);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "");
      chmodSync(path, 0o644);
      return path;
    },
  };
}

function mode(path: string) {
  return statSync(path).mode & 0o777;
}

describe("restoreSpawnHelperPermissions", () => {
  it("makes every packaged spawn-helper executable on macOS", async () => {
    const root = mkdtempSync(join(tmpdir(), "afterpack-"));
    const app = packagedApp(root, "darwin");
    const arm64 = app.file("prebuilds/darwin-arm64/spawn-helper");
    const x64 = app.file("prebuilds/darwin-x64/spawn-helper");

    await restoreSpawnHelperPermissions(app.context);

    expect(mode(arm64)).toBe(0o755);
    expect(mode(x64)).toBe(0o755);
  });

  it("leaves other node-pty files and Windows builds untouched", async () => {
    const root = mkdtempSync(join(tmpdir(), "afterpack-"));
    const mac = packagedApp(root, "darwin");
    const helper = mac.file("prebuilds/darwin-arm64/spawn-helper");
    const nativeModule = mac.file("prebuilds/darwin-arm64/pty.node");
    const windows = packagedApp(root, "win32");
    const windowsHelper = windows.file("prebuilds/win32-x64/spawn-helper");

    await restoreSpawnHelperPermissions(mac.context);
    await restoreSpawnHelperPermissions(windows.context);

    expect(mode(helper)).toBe(0o755);
    expect(mode(nativeModule)).toBe(0o644);
    expect(mode(windowsHelper)).toBe(0o644);
  });

  it("does nothing when node-pty is not packaged", async () => {
    const root = mkdtempSync(join(tmpdir(), "afterpack-"));
    const app = packagedApp(root, "darwin");

    await restoreSpawnHelperPermissions(app.context);
  });
});
