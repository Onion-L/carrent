import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PermissionRuleView } from "../../src/shared/permissionRules";

type StoredRule = { prefix: string[]; decision: "allow" | "prompt" | "forbidden"; domain?: string };
const userFile = () => path.join(os.homedir(), ".carrent", "rules", "default.rules.json");

async function readRules(filePath: string): Promise<StoredRule[]> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    const entries = Array.isArray(value) ? value : value?.rules;
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (entry): entry is StoredRule =>
        entry &&
        Array.isArray(entry.prefix) &&
        entry.prefix.every((item: unknown) => typeof item === "string") &&
        ["allow", "prompt", "forbidden"].includes(entry.decision),
    );
  } catch {
    return [];
  }
}

export async function listPermissionRules(
  projectDirectories: string[] = [],
): Promise<PermissionRuleView[]> {
  const result: PermissionRuleView[] = [
    ["rm", "-rf"],
    ["git", "reset", "--hard"],
    ["git", "push", "--force"],
    ["kill"],
  ].map((prefix, index) => ({
    id: `built-in:${index}`,
    prefix,
    decision: "prompt",
    origin: "built-in",
  }));
  for (const [index, rule] of (await readRules(userFile())).entries()) {
    result.push({ id: `user:${index}`, ...rule, origin: "user" });
  }
  for (const projectDirectory of projectDirectories) {
    const directory = path.join(projectDirectory, ".carrent", "rules");
    let files: string[] = [];
    try {
      files = (await readdir(directory)).filter((file) => file.endsWith(".rules.json")).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      for (const [index, rule] of (await readRules(path.join(directory, file))).entries()) {
        result.push({
          id: `project:${projectDirectory}:${file}:${index}`,
          ...rule,
          origin: "project",
          projectDirectory,
        });
      }
    }
  }
  return result;
}

export async function revokeUserPermissionRule(id: string): Promise<void> {
  if (!id.startsWith("user:")) throw new Error("Only user rules can be revoked.");
  const index = Number(id.slice(5));
  if (!Number.isInteger(index) || index < 0) throw new Error("Invalid permission rule.");
  const rules = await readRules(userFile());
  rules.splice(index, 1);
  await mkdir(path.dirname(userFile()), { recursive: true });
  await writeFile(userFile(), `${JSON.stringify(rules, null, 2)}\n`, "utf8");
}

export async function addUserPermissionRule(rule: StoredRule): Promise<void> {
  const rules = await readRules(userFile());
  rules.push(rule);
  await mkdir(path.dirname(userFile()), { recursive: true });
  await writeFile(userFile(), `${JSON.stringify(rules, null, 2)}\n`, "utf8");
}
