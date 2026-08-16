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
  const normalizedPath = normalizeLocalPathContextPath(filePath);
  if (!normalizedPath) {
    return { revealed: false, reason: "missing" };
  }

  try {
    const resolvedPath = await realpath(normalizedPath);
    const stats = await stat(resolvedPath);
    if (!stats.isFile() && !stats.isDirectory()) {
      return { revealed: false, reason: "missing" };
    }
    reveal(resolvedPath);
    return { revealed: true };
  } catch {
    return { revealed: false, reason: "missing" };
  }
}
