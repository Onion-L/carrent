import {
  getAgentAuthPath,
  loadAgentAuth,
  saveAgentAuth,
  type AgentAuthFile,
  type ProviderProfile,
} from "@carrent/core";

import type { AgentAuthView, SaveAgentAuthRequest } from "../../src/shared/agentAuth";

type IpcMainLike = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
};

function viewOf(auth: AgentAuthFile | null): AgentAuthView {
  return {
    path: getAgentAuthPath(),
    activeProfileId: auth?.activeProfileId ?? "",
    profiles: Object.values(auth?.profiles ?? {}).map((profile) => ({
      id: profile.id,
      type: profile.type,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      hasApiKey: Boolean(profile.apiKey),
    })),
  };
}

export function parseAgentAuthSaveRequest(value: unknown): SaveAgentAuthRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid Provider Profile request.");
  const request = value as Partial<SaveAgentAuthRequest>;
  if (
    typeof request.activeProfileId !== "string" ||
    !Array.isArray(request.profiles) ||
    request.profiles.length === 0 ||
    request.profiles.length > 20
  ) {
    throw new Error("At least one Provider Profile is required.");
  }
  for (const profile of request.profiles) {
    if (
      !profile ||
      typeof profile !== "object" ||
      typeof profile.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(profile.id) ||
      (profile.type !== "anthropic" && profile.type !== "openai-compatible") ||
      typeof profile.baseUrl !== "string" ||
      typeof profile.modelId !== "string" ||
      (profile.apiKey !== undefined && typeof profile.apiKey !== "string")
    ) {
      throw new Error("Provider Profile fields are invalid.");
    }
    const url = new URL(profile.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Provider Base URL must use HTTP or HTTPS.");
    }
    if (!profile.modelId.trim()) throw new Error("Provider Model ID is required.");
  }
  if (new Set(request.profiles.map((profile) => profile.id)).size !== request.profiles.length) {
    throw new Error("Provider Profile IDs must be unique.");
  }
  if (!request.profiles.some((profile) => profile.id === request.activeProfileId)) {
    throw new Error("The active Provider Profile does not exist.");
  }
  return request as SaveAgentAuthRequest;
}

export function registerAgentAuthIpc(ipcMainLike: IpcMainLike) {
  ipcMainLike.handle("agent-auth:load", async () => viewOf(await loadAgentAuth()));
  ipcMainLike.handle("agent-auth:save", async (_event, value) => {
    const request = parseAgentAuthSaveRequest(value);
    const existing = await loadAgentAuth();
    const profiles: Record<string, ProviderProfile> = {};
    for (const profile of request.profiles) {
      const apiKey = profile.apiKey?.trim() || existing?.profiles[profile.id]?.apiKey || "";
      if (!apiKey) throw new Error(`API Key is required for ${profile.id}.`);
      profiles[profile.id] = {
        id: profile.id,
        type: profile.type,
        apiKey,
        baseUrl: profile.baseUrl.trim().replace(/\/$/, ""),
        modelId: profile.modelId.trim(),
      };
    }
    await saveAgentAuth({ version: 1, activeProfileId: request.activeProfileId, profiles });
    return viewOf(await loadAgentAuth());
  });
}
