import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SkillRecord, SkillSource } from "../../src/shared/skills";

const SKILL_FILE = "SKILL.md";
const MAX_SKILL_FILE_BYTES = 96 * 1024;

type SkillRoot = {
  path: string;
  source: SkillSource;
  maxDepth: number;
};

export async function listInstalledSkills(homeDir = os.homedir()): Promise<SkillRecord[]> {
  const roots: SkillRoot[] = [
    {
      path: path.join(homeDir, ".agents", "skills"),
      source: "agents",
      maxDepth: 2,
    },
    {
      path: path.join(homeDir, ".codex", "skills"),
      source: "codex",
      maxDepth: 3,
    },
    {
      path: path.join(homeDir, ".codex", "plugins", "cache"),
      source: "plugin",
      maxDepth: 8,
    },
  ];

  const skillFiles = (
    await Promise.all(
      roots.map(async (root) =>
        (await collectSkillFiles(root.path, root.maxDepth)).map((skillPath) => ({
          path: skillPath,
          source: root.source,
        })),
      ),
    )
  ).flat();

  const skills = await Promise.all(
    skillFiles.map(async (skillFile) => {
      try {
        const content = await readLimitedTextFile(skillFile.path);
        const metadata = parseSkillFrontMatter(content);
        if (!metadata) {
          return null;
        }

        return {
          ...metadata,
          path: skillFile.path,
          source: skillFile.source,
        } satisfies SkillRecord;
      } catch {
        return null;
      }
    }),
  );

  return skills
    .filter((skill): skill is SkillRecord => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function parseSkillFrontMatter(
  content: string,
): Pick<SkillRecord, "name" | "description"> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (!match) {
    return null;
  }

  const name = readFrontMatterString(match[1], "name");
  const description = readFrontMatterString(match[1], "description");
  if (!name || !description) {
    return null;
  }

  return { name, description };
}

async function collectSkillFiles(root: string, maxDepth: number): Promise<string[]> {
  if (maxDepth < 0) {
    return [];
  }

  let entries: Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  const childDirs: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === SKILL_FILE) {
      files.push(entryPath);
    } else if (entry.isDirectory()) {
      childDirs.push(entryPath);
    }
  }

  const nested = await Promise.all(childDirs.map((dir) => collectSkillFiles(dir, maxDepth - 1)));
  return [...files, ...nested.flat()];
}

async function readLimitedTextFile(filePath: string) {
  const content = await readFile(filePath, "utf8");
  return content.length > MAX_SKILL_FILE_BYTES ? content.slice(0, MAX_SKILL_FILE_BYTES) : content;
}

function readFrontMatterString(frontMatter: string, key: string) {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, "imu");
  const match = pattern.exec(frontMatter);
  if (!match) {
    return "";
  }

  return unquoteYamlString(match[1].trim()).trim();
}

function unquoteYamlString(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
