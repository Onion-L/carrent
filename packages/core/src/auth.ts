import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentAuthFile, ProviderProfile, ProviderProfileType } from "./types";

const AUTH_VERSION = 1;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function getAgentAuthPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, ".carrent", "agent", "auth.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProfile(id: string, value: unknown): ProviderProfile | null {
  if (!PROFILE_ID_PATTERN.test(id) || !isRecord(value)) return null;
  const type: ProviderProfileType | null =
    value.type === "anthropic" || value.api === "anthropic"
      ? "anthropic"
      : value.type === "openai-compatible" || value.api === "openai-compatible"
        ? "openai-compatible"
        : null;
  const apiKey = (
    typeof value.apiKey === "string"
      ? value.apiKey
      : value.type === "api_key" && typeof value.key === "string"
        ? value.key
        : ""
  ).trim();
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (!type || !apiKey || !baseUrl || !modelId) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { id, type, apiKey, baseUrl, modelId, thinking: value.thinking === true };
}

export function normalizeAgentAuthFile(value: unknown): AgentAuthFile | null {
  if (!isRecord(value) || !isRecord(value.profiles)) return null;
  const profiles = Object.fromEntries(
    Object.entries(value.profiles).flatMap(([id, candidate]) => {
      const profile = readProfile(id, candidate);
      return profile ? [[id, profile] as const] : [];
    }),
  );
  const ids = Object.keys(profiles);
  if (ids.length === 0) return null;
  const activeProfileId =
    typeof value.activeProfileId === "string" && profiles[value.activeProfileId]
      ? value.activeProfileId
      : ids[0]!;
  return { version: AUTH_VERSION, activeProfileId, profiles };
}

export async function loadAgentAuth(homeDirectory = os.homedir()): Promise<AgentAuthFile | null> {
  try {
    const content = await readFile(getAgentAuthPath(homeDirectory), "utf8");
    return normalizeAgentAuthFile(JSON.parse(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error("Carrent agent auth.json is invalid JSON.");
    throw error;
  }
}

export async function saveAgentAuth(
  auth: AgentAuthFile,
  homeDirectory = os.homedir(),
): Promise<void> {
  const normalized = normalizeAgentAuthFile(auth);
  if (!normalized) throw new Error("At least one complete Provider Profile is required.");
  const filePath = getAgentAuthPath(homeDirectory);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
