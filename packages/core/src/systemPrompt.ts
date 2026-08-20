import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE_SYSTEM_PROMPT = `You are Carrent, a coding agent working in a local project.
Work until the user's request is fully handled. Inspect the project before making assumptions.
Use read, grep, find, and ls to understand the code. Use edit or write for file changes and bash for commands.
Keep changes focused, preserve unrelated user work, and verify changes with relevant tests or checks.
Never claim that a tool action succeeded unless its result confirms success.`;

async function readOptional(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return content.trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function buildSystemPrompt(options: {
  workingDirectory: string;
  homeDirectory?: string;
  override?: string;
}): Promise<string> {
  if (options.override?.trim()) return options.override.trim();
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const instructions = await Promise.all([
    readOptional(path.join(homeDirectory, ".agents", "AGENTS.md")),
    readOptional(path.join(options.workingDirectory, "AGENTS.md")),
  ]);
  const sections = [BASE_SYSTEM_PROMPT];
  if (instructions[0]) sections.push(`Global instructions:\n${instructions[0]}`);
  if (instructions[1]) sections.push(`Project instructions:\n${instructions[1]}`);
  sections.push(`Project working directory: ${options.workingDirectory}`);
  return sections.join("\n\n");
}
