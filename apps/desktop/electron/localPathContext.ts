import type { Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";

import {
  normalizeLocalPathContextItem,
  normalizeLocalPathContextPath,
  type LocalPathResolutionRejection,
  type LocalPathResolutionResult,
  type RevealPathResult,
} from "../src/shared/localPathContext";

export async function resolveDroppedLocalPaths(paths: unknown): Promise<LocalPathResolutionResult> {
  if (!Array.isArray(paths)) {
    return { items: [], rejections: [] };
  }

  const items: LocalPathResolutionResult["items"] = [];
  const rejections: LocalPathResolutionRejection[] = [];

  for (const [index, rawPath] of paths.entries()) {
    const normalizedPath = normalizeLocalPathContextItem({ path: rawPath, kind: "file" });
    if (!normalizedPath) {
      rejections.push({ index, reason: "non-local" });
      continue;
    }

    try {
      const stats = await stat(normalizedPath.path);
      const kind = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : null;
      if (!kind) {
        rejections.push({ index, reason: "unsupported-kind" });
        continue;
      }
      items.push({ ...normalizedPath, kind });
    } catch {
      rejections.push({ index, reason: "unavailable" });
    }
  }

  return { items, rejections };
}

export async function revealLocalPath(
  filePath: string,
  reveal: (filePath: string) => void,
): Promise<RevealPathResult> {
  try {
    await stat(filePath);
  } catch {
    return { revealed: false, reason: "missing" };
  }

  reveal(filePath);
  return { revealed: true };
}

// Extensions whose directories LaunchServices executes when opened
// (macOS app bundles and kin). Applied on every platform: opening such a
// directory is never the "reveal this folder" intent.
const LAUNCHABLE_DIRECTORY_EXTENSIONS = new Set([
  ".app",
  ".bundle",
  ".framework",
  ".prefpane",
  ".saver",
  ".action",
  ".widget",
  ".xpc",
  ".installer",
  ".mpkg",
]);

// File extensions the OS would execute, hand to an installer, or resolve
// as a shortcut to another program (.lnk can launch anything; .url/.scf
// are shell-resolved; .command runs in Terminal).
const LAUNCHABLE_FILE_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".msix",
  ".appx",
  ".scr",
  ".ps1",
  ".hta",
  ".lnk",
  ".url",
  ".scf",
  ".application",
  ".vbs",
  ".vbe",
  ".jse",
  ".wsf",
  ".wsh",
  ".jar",
  ".command",
  ".pkg",
  ".deb",
  ".rpm",
  ".apk",
]);

function pathExtension(resolvedPath: string): string {
  const basename = resolvedPath.slice(resolvedPath.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  return dot < 0 ? "" : basename.slice(dot).toLowerCase();
}

// Opens a local path through the OS opener only after resolving symlinks
// and verifying the *real* target is not an OS-launchable bundle,
// executable, installer, or shortcut. All decisions run against the
// realpath, never the caller-supplied spelling, so a "readme.txt" symlink
// to "malware.exe" is judged by its target. Returns "" on success or a
// human-readable error string, matching the shell.openPath result contract
// the renderer already toasts.
export async function openLocalPath(
  filePath: string,
  open: (filePath: string) => Promise<string>,
): Promise<string> {
  const normalizedPath = normalizeLocalPathContextPath(filePath);
  if (!normalizedPath) {
    return "Path must be an absolute local file or directory.";
  }

  let resolvedPath: string;
  let stats: Stats;
  try {
    resolvedPath = await realpath(normalizedPath);
    stats = await stat(resolvedPath);
  } catch {
    return "Path does not exist.";
  }

  if (stats.isDirectory()) {
    if (LAUNCHABLE_DIRECTORY_EXTENSIONS.has(pathExtension(resolvedPath))) {
      return "Opening application bundles is not allowed.";
    }
  } else if (stats.isFile()) {
    if (LAUNCHABLE_FILE_EXTENSIONS.has(pathExtension(resolvedPath))) {
      return "Opening executable, installer, or shortcut files is not allowed.";
    }
    if (process.platform !== "win32" && (stats.mode & 0o111) !== 0) {
      return "Opening executable files is not allowed.";
    }
  } else {
    return "Path is not a file or directory.";
  }

  // Open exactly the validated realpath. A swap between the checks above
  // and this open (TOCTOU) remains theoretically possible; this raises the
  // bar far above the previous no-validation state, but is not a hard
  // guarantee.
  return open(resolvedPath);
}
