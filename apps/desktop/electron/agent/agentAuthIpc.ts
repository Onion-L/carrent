import {
  createAgentModels,
  credentialForProfile,
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
    profiles: Object.values(auth?.profiles ?? {}).map((profile) => {
      const { models } = createAgentModels(profile);
      return {
        id: profile.id,
        type: profile.type,
        baseUrl: profile.baseUrl,
        modelId: profile.modelId,
        thinking: profile.thinking === true,
        hasApiKey: credentialForProfile(profile)?.type === "api_key",
        authType: credentialForProfile(profile)?.type,
        oauthSupported: profile.type === "kimi-coding",
        models: models.getModels(profile.id).map((model) => ({ id: model.id, name: model.name })),
      };
    }),
  };
}

type AgentAuthIpcOptions = {
  openExternal?: (url: string) => Promise<void>;
};

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
      (profile.type !== "anthropic" &&
        profile.type !== "openai-compatible" &&
        profile.type !== "kimi-coding") ||
      typeof profile.baseUrl !== "string" ||
      typeof profile.modelId !== "string" ||
      (profile.thinking !== undefined && typeof profile.thinking !== "boolean") ||
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

export function registerAgentAuthIpc(ipcMainLike: IpcMainLike, options: AgentAuthIpcOptions = {}) {
  const loginControllers = new Map<string, AbortController>();
  ipcMainLike.handle("agent-auth:load", async () => viewOf(await loadAgentAuth()));
  ipcMainLike.handle("agent-auth:save", async (_event, value) => {
    const request = parseAgentAuthSaveRequest(value);
    const existing = await loadAgentAuth();
    const profiles: Record<string, ProviderProfile> = {};
    for (const profile of request.profiles) {
      const existingProfile = existing?.profiles[profile.id];
      const sameProviderType = existingProfile?.type === profile.type;
      const apiKey =
        profile.apiKey?.trim() || (sameProviderType ? existingProfile?.apiKey : "") || "";
      const credential = sameProviderType ? existingProfile?.credential : undefined;
      if (profile.type === "openai-compatible" && !apiKey)
        throw new Error(`API Key or OAuth login is required for ${profile.id}.`);
      profiles[profile.id] = {
        id: profile.id,
        type: profile.type,
        ...(apiKey ? { apiKey } : { credential }),
        baseUrl: profile.baseUrl.trim().replace(/\/$/, ""),
        modelId: profile.modelId.trim(),
        thinking: profile.thinking === true,
      };
    }
    await saveAgentAuth({ version: 1, activeProfileId: request.activeProfileId, profiles });
    return viewOf(await loadAgentAuth());
  });
  ipcMainLike.handle("agent-auth:login", async (_event, value) => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { profileId?: unknown }).profileId !== "string"
    ) {
      throw new Error("A Provider Profile is required.");
    }
    const auth = await loadAgentAuth();
    const profile = auth?.profiles[(value as { profileId: string }).profileId];
    if (!profile) throw new Error("Provider Profile does not exist.");
    if (profile.type !== "kimi-coding") {
      throw new Error("OAuth login is currently available for Kimi Coding profiles only.");
    }
    if (loginControllers.has(profile.id)) throw new Error("OAuth login is already in progress.");
    const controller = new AbortController();
    loginControllers.set(profile.id, controller);
    const { models } = createAgentModels(profile);
    try {
      await models.login(profile.id, "oauth", {
        signal: controller.signal,
        prompt: async (prompt) => {
          if (prompt.type === "select") return prompt.options[0]?.id ?? "";
          if (prompt.type === "manual_code") {
            return new Promise<string>((_resolve, reject) => {
              const cancel = () => reject(new Error("OAuth login cancelled."));
              if (controller.signal.aborted || prompt.signal?.aborted) return cancel();
              controller.signal.addEventListener("abort", cancel, { once: true });
              prompt.signal?.addEventListener("abort", cancel, { once: true });
            });
          }
          throw new Error(`Unsupported OAuth prompt: ${prompt.type}`);
        },
        notify: (event) => {
          if (event.type === "auth_url") {
            void options.openExternal?.(event.url);
          } else if (event.type === "device_code") {
            void options.openExternal?.(event.verificationUri);
          }
        },
      });
      return viewOf(await loadAgentAuth());
    } finally {
      loginControllers.delete(profile.id);
    }
  });
  ipcMainLike.handle("agent-auth:cancel-login", async (_event, value) => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { profileId?: unknown }).profileId !== "string"
    ) {
      throw new Error("A Provider Profile is required.");
    }
    loginControllers.get((value as { profileId: string }).profileId)?.abort();
  });
  ipcMainLike.handle("agent-auth:logout", async (_event, value) => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { profileId?: unknown }).profileId !== "string"
    ) {
      throw new Error("A Provider Profile is required.");
    }
    const auth = await loadAgentAuth();
    const profile = auth?.profiles[(value as { profileId: string }).profileId];
    if (!profile) throw new Error("Provider Profile does not exist.");
    const { models } = createAgentModels(profile);
    await models.logout(profile.id);
    return viewOf(await loadAgentAuth());
  });
}
