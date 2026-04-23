import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TEMP_WORKSPACE_PREFIX = "carrent-runtime-";

export async function createTempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), TEMP_WORKSPACE_PREFIX));
}

export async function cleanupTempWorkspace(workspacePath: string): Promise<void> {
  await rm(workspacePath, { recursive: true, force: true });
}
