import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  KimiMemoryFile,
  KimiMemoryFileType,
  KimiMemoryIndex,
  KimiMemoryProject,
} from "../../src/shared/kimiMemory";

// NOTE: Kimi Code's persistent memory layout (<kimiCodeHome>/projects/<key>/memory/*.md
// with YAML-ish frontmatter) is not part of the documented kimi-code surface and may
// change without notice. Keep the parser tolerant and treat this as a Beta feature.

const KIMI_CODE_DIR = ".kimi-code";
const MEMORY_INDEX_FILE = "MEMORY.md";
const KNOWN_TYPES: ReadonlySet<string> = new Set(["user", "project", "feedback", "reference"]);

export interface KimiMemoryDeps {
  /** Defaults to os.homedir(); injectable for tests. */
  homeDir?: string;
  /** Overrides the kimi-code home entirely; injectable for tests. */
  kimiCodeDir?: string;
}

function resolveKimiCodeDir(deps: KimiMemoryDeps): string {
  if (deps.kimiCodeDir !== undefined) return deps.kimiCodeDir;
  const envHome = process.env.KIMI_CODE_HOME;
  if (typeof envHome === "string" && envHome !== "") return envHome;
  return path.join(deps.homeDir ?? os.homedir(), KIMI_CODE_DIR);
}

/** "-Users-onion-workbench-carrent-17e396ae3d2e" -> "carrent". */
export function projectDisplayName(key: string): string {
  const withoutHash = key.replace(/-[0-9a-f]{12}$/u, "");
  const segments = withoutHash.split("-").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? key;
}

/** Minimal frontmatter parser: `key: value` lines between `---` fences. */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const text = content.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { frontmatter: {}, body: text };

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) return { frontmatter: {}, body: text };

  const frontmatter: Record<string, string> = {};
  for (let index = 1; index < end; index += 1) {
    const line = lines[index]!;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key !== "") frontmatter[key] = value;
  }

  return {
    frontmatter,
    body: lines
      .slice(end + 1)
      .join("\n")
      .replace(/^\n+/u, ""),
  };
}

async function readMemoryFile(filePath: string, fileName: string): Promise<KimiMemoryFile | null> {
  let content: string;
  let mtimeMs: number;
  try {
    const [raw, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
    content = raw;
    mtimeMs = stat.mtimeMs;
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter(content);
  const rawType = frontmatter.type ?? "";
  const type: KimiMemoryFileType = KNOWN_TYPES.has(rawType)
    ? (rawType as KimiMemoryFileType)
    : "other";
  const name =
    frontmatter.name !== undefined && frontmatter.name !== ""
      ? frontmatter.name
      : fileName.replace(/\.md$/u, "");

  return {
    path: filePath,
    fileName,
    name,
    description: frontmatter.description ?? "",
    type,
    body,
    raw: content,
    modifiedAt: mtimeMs,
    isIndex: fileName === MEMORY_INDEX_FILE,
  };
}

export async function listKimiMemory(deps: KimiMemoryDeps = {}): Promise<KimiMemoryIndex> {
  const projectsDir = path.join(resolveKimiCodeDir(deps), "projects");

  let projectEntries;
  try {
    projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return { projects: [], scannedAt: new Date().toISOString() };
  }

  const projects: KimiMemoryProject[] = [];
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue;
    const memoryDir = path.join(projectsDir, entry.name, "memory");

    let memoryEntries;
    try {
      memoryEntries = await fs.readdir(memoryDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const files: KimiMemoryFile[] = [];
    for (const memoryEntry of memoryEntries) {
      if (!memoryEntry.isFile() || !memoryEntry.name.endsWith(".md")) continue;
      const parsed = await readMemoryFile(path.join(memoryDir, memoryEntry.name), memoryEntry.name);
      if (parsed !== null) files.push(parsed);
    }
    if (files.length === 0) continue;

    // Index file first, then alphabetical by file name.
    files.sort((a, b) => {
      if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1;
      return a.fileName.localeCompare(b.fileName);
    });
    projects.push({ key: entry.name, name: projectDisplayName(entry.name), files });
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return { projects, scannedAt: new Date().toISOString() };
}

export async function deleteKimiMemoryFile(
  filePath: string,
  deps: KimiMemoryDeps = {},
): Promise<void> {
  const projectsDir = path.join(resolveKimiCodeDir(deps), "projects");
  const resolved = path.resolve(filePath);

  // Safety: only delete files that live exactly at projects/<key>/memory/<file>.
  const relative = path.relative(projectsDir, resolved);
  const segments = relative.split(path.sep);
  const isMemoryFile =
    segments.length === 3 && segments[0] !== "" && segments[1] === "memory" && segments[2] !== "";
  if (!isMemoryFile || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to delete a file outside the Kimi Code memory directories.");
  }

  await fs.unlink(resolved);
}
