import os from "node:os";

import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api,
  type Credential,
  type CredentialStore,
  type Model,
  type Models,
  type Provider,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";

import { loadAgentAuth, saveAgentAuth } from "./auth";
import type { ProviderProfile } from "./types";

registerBunOAuthFlows();

const DEFAULT_CARRENT_VERSION = "0.0.3";

function kimiUserAgent(version = DEFAULT_CARRENT_VERSION) {
  return `carrent/${version}`;
}

function profileCredential(profile: ProviderProfile): Credential | undefined {
  if (profile.credential) return profile.credential;
  return profile.apiKey ? { type: "api_key", key: profile.apiKey } : undefined;
}

let credentialWriteChain: Promise<unknown> = Promise.resolve();

/** Persistent adapter used by pi-ai to read and atomically refresh credentials. */
export function createAgentCredentialStore(homeDirectory = os.homedir()): CredentialStore {
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = credentialWriteChain.catch(() => undefined).then(task);
    credentialWriteChain = next.catch(() => undefined);
    return next;
  };

  const readFile = async () => {
    const auth = await loadAgentAuth(homeDirectory);
    return auth;
  };

  return {
    async read(providerId) {
      const auth = await readFile();
      return auth?.profiles[providerId] ? profileCredential(auth.profiles[providerId]) : undefined;
    },
    async list() {
      const auth = await readFile();
      return Object.values(auth?.profiles ?? {}).flatMap((profile) => {
        const credential = profileCredential(profile);
        return credential ? [{ providerId: profile.id, type: credential.type }] : [];
      });
    },
    modify(providerId, fn) {
      return enqueue(async () => {
        const auth = await readFile();
        const profile = auth?.profiles[providerId];
        if (!auth || !profile) return fn(undefined);
        const next = await fn(profileCredential(profile));
        if (next) {
          profile.credential = next;
          delete profile.apiKey;
          if (next.type === "api_key" && next.key) {
            profile.apiKey = next.key;
            delete profile.credential;
          }
        }
        await saveAgentAuth(auth, homeDirectory);
        return next;
      });
    },
    delete(providerId) {
      return enqueue(async () => {
        const auth = await readFile();
        const profile = auth?.profiles[providerId];
        if (!auth || !profile) return;
        delete profile.apiKey;
        delete profile.credential;
        await saveAgentAuth(auth, homeDirectory);
      });
    },
  };
}

function customModel(
  profile: ProviderProfile,
  id = profile.modelId,
  name = id,
  clientVersion?: string,
): Model<Api> {
  const api =
    profile.type === "anthropic" || profile.type === "kimi-coding"
      ? "anthropic-messages"
      : "openai-completions";
  return {
    id,
    name,
    api,
    provider: profile.id,
    baseUrl: profile.baseUrl.replace(/\/$/, ""),
    reasoning: profile.thinking === true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: profile.type === "anthropic" ? 200_000 : 128_000,
    maxTokens: 8_192,
    ...(profile.type === "kimi-coding"
      ? { headers: { "User-Agent": kimiUserAgent(clientVersion) } }
      : {}),
    ...(profile.thinking
      ? {
          thinkingLevelMap: {
            off: null,
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "xhigh",
            max: "max",
          },
        }
      : {}),
  } as Model<Api>;
}

function providerFor(profile: ProviderProfile, clientVersion?: string): Provider {
  const builtin =
    profile.type === "anthropic"
      ? anthropicProvider()
      : profile.type === "kimi-coding"
        ? kimiCodingProvider()
        : undefined;
  const api =
    profile.type === "anthropic" || profile.type === "kimi-coding"
      ? "anthropic-messages"
      : "openai-completions";
  const auth =
    profile.type === "anthropic" && builtin
      ? { apiKey: builtin.auth.apiKey }
      : (builtin?.auth ?? { apiKey: envApiKeyAuth("Provider API key", []) });
  const model = customModel(profile, profile.modelId, profile.modelId, clientVersion);
  const catalog = builtin
    ? [
        ...builtin.getModels().map((catalogModel) => ({
          ...catalogModel,
          provider: profile.id,
          baseUrl: profile.baseUrl.replace(/\/$/, ""),
          ...(profile.type === "kimi-coding"
            ? { headers: { ...catalogModel.headers, "User-Agent": kimiUserAgent(clientVersion) } }
            : {}),
        })),
        ...(builtin.getModels().some((catalogModel) => catalogModel.id === model.id)
          ? []
          : [model]),
      ]
    : [model];
  // A stored selection (chosen in the Add Provider flow) replaces the catalog;
  // ids the catalog doesn't know get a synthesized entry so they still run.
  const models = profile.models?.length
    ? profile.models.map(
        (selected) =>
          catalog.find((candidate) => candidate.id === selected.id) ??
          customModel(profile, selected.id, selected.name, clientVersion),
      )
    : catalog;
  return createProvider({
    id: profile.id,
    name: profile.id,
    baseUrl: profile.baseUrl.replace(/\/$/, ""),
    auth,
    models,
    api: api === "anthropic-messages" ? anthropicMessagesApi() : openAICompletionsApi(),
  });
}

export function createAgentModels(
  profile: ProviderProfile,
  homeDirectory = os.homedir(),
  clientVersion?: string,
): { models: Models; model: Model<Api> } {
  const models = createModels({ credentials: createAgentCredentialStore(homeDirectory) });
  const provider = providerFor(profile, clientVersion);
  models.setProvider(provider);
  return {
    models,
    model:
      provider.getModels().find((candidate) => candidate.id === profile.modelId) ??
      provider.getModels()[0]!,
  };
}

export function credentialForProfile(profile: ProviderProfile): Credential | undefined {
  return profileCredential(profile);
}
