import { stat } from "node:fs/promises";

import {
  normalizeLocalPathContextItem,
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
    const item = normalizeLocalPathContextItem({ path: rawPath, kind: "file" });
    if (!item) {
      rejections.push({ index, reason: "non-local" });
      continue;
    }

    try {
      const stats = await stat(item.path);
      if (!stats.isFile()) {
        rejections.push({ index, reason: "not-file" });
        continue;
      }
      items.push(item);
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
