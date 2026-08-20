import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export function resolveToolPath(workingDirectory: string, candidate = "."): string {
  return path.resolve(workingDirectory, candidate);
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function canonicalizePath(candidate: string): Promise<string> {
  const missingSegments: string[] = [];
  let current = candidate;
  while (true) {
    try {
      return path.join(await realpath(current), ...missingSegments.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

export async function isDirectory(candidate: string): Promise<boolean> {
  return (await stat(candidate)).isDirectory();
}
