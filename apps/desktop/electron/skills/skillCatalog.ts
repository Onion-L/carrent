import { readdir, readFile, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SkillRecord, SkillSource } from "../../src/shared/skills";

const SKILL_FILE = "SKILL.md";
const MAX_SKILL_FILE_BYTES = 96 * 1024;
const MAX_RESOURCE_FILE_BYTES = 256 * 1024;
const MAX_RESOURCE_DEPTH = 8;
const MAX_RESOURCE_COUNT = 300;

type SkillRoot = {
  path: string;
  source: SkillSource;
  maxDepth: number;
};

export type ResolvedSkillRecord = SkillRecord & {
  declaredPath: string;
  realPath: string;
  declaredRootPath: string;
  realRootPath: string;
};

export type SkillLocator = {
  name?: string;
  path?: string;
};

export type SkillReadResult = {
  skill: ResolvedSkillRecord;
  content: string;
};

export type SkillResourceRecord = {
  path: string;
  size: number;
};

export type SkillResourceReadResult = {
  skill: ResolvedSkillRecord;
  resource: SkillResourceRecord;
  content: string;
};

export type SkillCatalogErrorCode =
  | "skill_not_found"
  | "resource_not_found"
  | "resource_outside_skill"
  | "resource_too_large"
  | "unsupported_resource";

export class SkillCatalogError extends Error {
  constructor(
    readonly code: SkillCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkillCatalogError";
  }
}

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
        const declaredPath = skillFile.path;
        const declaredRootPath = path.dirname(declaredPath);
        const realPath = await realpath(declaredPath);
        const realRootPath = await realpath(declaredRootPath);
        if (!isInsideRoot(realRootPath, realPath)) {
          return null;
        }

        return {
          ...metadata,
          path: declaredPath,
          source: skillFile.source,
          declaredPath,
          realPath,
          declaredRootPath,
          realRootPath,
        } satisfies ResolvedSkillRecord;
      } catch {
        return null;
      }
    }),
  );

  return skills
    .filter((skill): skill is ResolvedSkillRecord => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function readSkill(
  locator: SkillLocator,
  options: { homeDir?: string } = {},
): Promise<SkillReadResult> {
  const skill = await findInstalledSkill(locator, options.homeDir);
  return {
    skill,
    content: await readBoundedTextFile(skill.realPath, MAX_SKILL_FILE_BYTES),
  };
}

export async function listSkillResources(
  locator: SkillLocator,
  options: { homeDir?: string } = {},
): Promise<{ skill: ResolvedSkillRecord; resources: SkillResourceRecord[] }> {
  const skill = await findInstalledSkill(locator, options.homeDir);
  const resources = await collectSkillResources(skill.realRootPath, {
    maxDepth: MAX_RESOURCE_DEPTH,
    maxCount: MAX_RESOURCE_COUNT,
  });
  return { skill, resources };
}

export async function readSkillResource(
  locator: SkillLocator,
  resourcePath: string,
  options: { homeDir?: string } = {},
): Promise<SkillResourceReadResult> {
  const skill = await findInstalledSkill(locator, options.homeDir);
  const normalizedResourcePath = normalizeResourcePath(resourcePath);
  const candidatePath = path.resolve(skill.realRootPath, normalizedResourcePath);
  const targetRealPath = await realpath(candidatePath).catch(() => {
    throw new SkillCatalogError("resource_not_found", `Skill resource not found: ${resourcePath}`);
  });
  assertInsideRoot(skill.realRootPath, targetRealPath, resourcePath);
  const fileStat = await stat(targetRealPath).catch(() => {
    throw new SkillCatalogError("resource_not_found", `Skill resource not found: ${resourcePath}`);
  });
  if (!fileStat.isFile()) {
    throw new SkillCatalogError("resource_not_found", `Skill resource not found: ${resourcePath}`);
  }

  return {
    skill,
    resource: {
      path: normalizedResourcePath,
      size: fileStat.size,
    },
    content: await readBoundedTextFile(targetRealPath, MAX_RESOURCE_FILE_BYTES),
  };
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
    } else if (entry.isSymbolicLink()) {
      const entryStat = await stat(entryPath).catch(() => null);
      if (entryStat?.isDirectory()) {
        childDirs.push(entryPath);
      }
    }
  }

  const nested = await Promise.all(childDirs.map((dir) => collectSkillFiles(dir, maxDepth - 1)));
  return [...files, ...nested.flat()];
}

async function readLimitedTextFile(filePath: string) {
  const content = await readFile(filePath, "utf8");
  return content.length > MAX_SKILL_FILE_BYTES ? content.slice(0, MAX_SKILL_FILE_BYTES) : content;
}

async function findInstalledSkill(
  locator: SkillLocator,
  homeDir = os.homedir(),
): Promise<ResolvedSkillRecord> {
  const skills = await listInstalledSkills(homeDir);
  const skill =
    skills.find((candidate) => {
      if (locator.name && candidate.name === locator.name) {
        return true;
      }

      if (!locator.path) {
        return false;
      }

      return (
        candidate.path === locator.path ||
        candidate.declaredPath === locator.path ||
        candidate.realPath === locator.path ||
        candidate.declaredRootPath === locator.path ||
        candidate.realRootPath === locator.path
      );
    }) ?? null;

  if (!skill || !isResolvedSkillRecord(skill)) {
    const label = locator.name ?? locator.path ?? "unknown";
    throw new SkillCatalogError("skill_not_found", `Skill not found: ${label}`);
  }

  return skill;
}

function isResolvedSkillRecord(skill: SkillRecord): skill is ResolvedSkillRecord {
  return (
    typeof skill.declaredPath === "string" &&
    typeof skill.realPath === "string" &&
    typeof skill.declaredRootPath === "string" &&
    typeof skill.realRootPath === "string"
  );
}

function normalizeResourcePath(resourcePath: string) {
  const trimmed = resourcePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    throw new SkillCatalogError("resource_outside_skill", `Invalid skill resource path.`);
  }

  if (trimmed.split(/[\\/]+/u).includes("..")) {
    throw new SkillCatalogError(
      "resource_outside_skill",
      `Refusing to read outside skill root: ${resourcePath}`,
    );
  }

  const normalized = path.normalize(trimmed);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new SkillCatalogError(
      "resource_outside_skill",
      `Refusing to read outside skill root: ${resourcePath}`,
    );
  }

  return normalized;
}

async function collectSkillResources(
  root: string,
  options: { maxDepth: number; maxCount: number },
) {
  const resources: SkillResourceRecord[] = [];
  const visitedDirs = new Set<string>();

  const walk = async (dir: string, depth: number) => {
    if (depth > options.maxDepth || resources.length >= options.maxCount) {
      return;
    }

    const dirRealPath = await realpath(dir).catch(() => null);
    if (!dirRealPath || visitedDirs.has(dirRealPath)) {
      return;
    }
    assertInsideRoot(root, dirRealPath, dir);
    visitedDirs.add(dirRealPath);

    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (resources.length >= options.maxCount) {
        return;
      }

      const entryPath = path.join(dir, entry.name);
      const entryRealPath = await realpath(entryPath).catch(() => null);
      if (!entryRealPath || !isInsideRoot(root, entryRealPath)) {
        continue;
      }

      const entryStat = await stat(entryRealPath).catch(() => null);
      if (!entryStat) {
        continue;
      }

      if (entryStat.isDirectory()) {
        await walk(entryRealPath, depth + 1);
        continue;
      }

      if (!entryStat.isFile()) {
        continue;
      }

      if (!(await isReadableTextResource(entryRealPath, entryStat.size))) {
        continue;
      }

      const relativePath = path.relative(root, entryRealPath);
      if (!relativePath || relativePath === SKILL_FILE || relativePath.startsWith("..")) {
        continue;
      }

      resources.push({
        path: relativePath,
        size: entryStat.size,
      });
    }
  };

  await walk(root, 0);
  return resources.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

async function isReadableTextResource(filePath: string, size: number) {
  if (size > MAX_RESOURCE_FILE_BYTES) {
    return false;
  }

  try {
    const buffer = await readFile(filePath);
    if (buffer.includes(0)) {
      return false;
    }
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

async function readBoundedTextFile(filePath: string, maxBytes: number) {
  const fileStat = await stat(filePath);
  if (fileStat.size > maxBytes) {
    throw new SkillCatalogError(
      "resource_too_large",
      `Skill resource is too large to read: ${fileStat.size} bytes`,
    );
  }

  const buffer = await readFile(filePath);
  if (buffer.includes(0)) {
    throw new SkillCatalogError("unsupported_resource", `Skill resource is not text.`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new SkillCatalogError("unsupported_resource", `Skill resource is not valid UTF-8 text.`);
  }
}

function assertInsideRoot(root: string, target: string, label: string) {
  if (!isInsideRoot(root, target)) {
    throw new SkillCatalogError(
      "resource_outside_skill",
      `Refusing to read outside skill root: ${label}`,
    );
  }
}

function isInsideRoot(root: string, target: string) {
  const relative = path.relative(root, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
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
