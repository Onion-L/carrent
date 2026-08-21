import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type PermissionDecision = "allow" | "prompt" | "forbidden";

export type PermissionRule = {
  prefix: string[];
  decision: PermissionDecision;
  origin?: "user" | "project" | "built-in";
  domain?: string;
};

export type PermissionRules = {
  user: PermissionRule[];
  project: PermissionRule[];
  malformed: boolean;
};

const DECISIONS = new Set<PermissionDecision>(["allow", "prompt", "forbidden"]);

function normalizePrefix(prefix: unknown): string[] | null {
  if (!Array.isArray(prefix)) return null;
  const values = prefix.map((value) => (typeof value === "string" ? value.trim() : ""));
  return values.every(Boolean) ? values : null;
}

function parseRules(value: unknown, origin: "user" | "project"): PermissionRule[] | null {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { rules?: unknown }).rules)
      ? (value as { rules: unknown[] }).rules
      : null;
  if (!entries) return null;
  const rules: PermissionRule[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const prefix = normalizePrefix(record.prefix);
    const decision = record.decision;
    const domain =
      typeof record.domain === "string" && record.domain.trim()
        ? record.domain.trim().toLowerCase()
        : undefined;
    if (
      !prefix ||
      (prefix.length === 0 && !domain) ||
      typeof decision !== "string" ||
      !DECISIONS.has(decision as PermissionDecision)
    ) {
      return null;
    }
    rules.push({
      prefix,
      decision: decision as PermissionDecision,
      origin,
      ...(domain ? { domain } : {}),
    });
  }
  return rules;
}

async function readRuleFile(filePath: string, origin: "user" | "project") {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = parseRules(JSON.parse(content), origin);
    return parsed ? { rules: parsed, malformed: false } : { rules: [], malformed: true };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return code === "ENOENT" ? { rules: [], malformed: false } : { rules: [], malformed: true };
  }
}

export async function loadPermissionRules(options: {
  homeDirectory?: string;
  projectDirectory: string;
  trusted?: boolean;
}): Promise<PermissionRules> {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const userPath = path.join(homeDirectory, ".carrent", "rules", "default.rules.json");
  const user = await readRuleFile(userPath, "user");
  if (options.trusted === false) {
    return { user: user.rules, project: [], malformed: user.malformed };
  }

  const projectRulesDirectory = path.join(options.projectDirectory, ".carrent", "rules");
  let projectFiles: string[] = [];
  let malformed = user.malformed;
  try {
    projectFiles = (await readdir(projectRulesDirectory))
      .filter((file) => file.endsWith(".rules.json"))
      .sort()
      .map((file) => path.join(projectRulesDirectory, file));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") malformed = true;
  }

  const project: PermissionRule[] = [];
  for (const filePath of projectFiles) {
    const result = await readRuleFile(filePath, "project");
    project.push(...result.rules);
    malformed ||= result.malformed;
  }
  return { user: user.rules, project, malformed };
}

export async function writeUserPermissionRule(options: {
  homeDirectory?: string;
  rule: Omit<PermissionRule, "origin">;
}): Promise<void> {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const filePath = path.join(homeDirectory, ".carrent", "rules", "default.rules.json");
  const directory = path.dirname(filePath);
  const current = await readRuleFile(filePath, "user");
  if (current.malformed) throw new Error("The user permission rules file is malformed.");
  const next = [
    ...current.rules.map(({ prefix, decision, domain }) => ({
      prefix,
      decision,
      ...(domain ? { domain } : {}),
    })),
    options.rule,
  ];
  await (await import("node:fs/promises")).mkdir(directory, { recursive: true });
  await (
    await import("node:fs/promises")
  ).writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function prefixMatches(prefix: string[], argv: string[]): boolean {
  return prefix.length <= argv.length && prefix.every((part, index) => part === argv[index]);
}
