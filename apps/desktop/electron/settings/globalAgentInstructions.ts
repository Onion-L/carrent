import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES = 256 * 1024;

export type GlobalAgentInstructionsSnapshot = {
  path: string;
  content: string;
  exists: boolean;
  maxBytes: number;
};

export function getGlobalAgentInstructionsPath(homeDir = homedir()): string {
  return path.join(homeDir, ".agents", "AGENTS.md");
}

export function getGlobalRtkInstructionsPath(homeDir = homedir()): string {
  return path.join(homeDir, ".agents", "RTK.md");
}

export async function readGlobalAgentInstructions(
  homeDir = homedir(),
): Promise<GlobalAgentInstructionsSnapshot> {
  const filePath = getGlobalAgentInstructionsPath(homeDir);

  try {
    const fileStats = await stat(filePath);
    if (fileStats.size > GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES) {
      throw new Error("Global agent instructions file is larger than 256KB.");
    }

    return {
      path: filePath,
      content: await readFile(filePath, "utf8"),
      exists: true,
      maxBytes: GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    return {
      path: filePath,
      content: "",
      exists: false,
      maxBytes: GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES,
    };
  }
}

export async function writeGlobalAgentInstructions(
  content: string,
  homeDir = homedir(),
): Promise<GlobalAgentInstructionsSnapshot> {
  if (Buffer.byteLength(content, "utf8") > GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES) {
    throw new Error("Global agent instructions must be 256KB or smaller.");
  }

  const filePath = getGlobalAgentInstructionsPath(homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return {
    path: filePath,
    content,
    exists: true,
    maxBytes: GLOBAL_AGENT_INSTRUCTIONS_MAX_BYTES,
  };
}

export async function writeGlobalRtkInstructions(
  content: string,
  homeDir = homedir(),
): Promise<{ path: string; content: string }> {
  const filePath = getGlobalRtkInstructionsPath(homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return {
    path: filePath,
    content,
  };
}
