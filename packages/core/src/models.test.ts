import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentModels } from "./models";
import { loadAgentAuth, saveAgentAuth } from "./auth";

describe("agent pi-ai models", () => {
  it("resolves a legacy API key through the Models auth layer", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "carrent-models-"));
    const profile = {
      id: "anthropic",
      type: "anthropic" as const,
      apiKey: "secret",
      baseUrl: "https://api.anthropic.com",
      modelId: "claude-test",
    };
    await saveAgentAuth(
      { version: 1, activeProfileId: profile.id, profiles: { anthropic: profile } },
      home,
    );

    const { models, model } = createAgentModels(profile, home, "9.9.9");
    expect((await models.getAuth(model))?.auth.apiKey).toBe("secret");
    expect((await models.getAvailable(profile.id)).map((item) => item.id)).toContain("claude-test");
    expect(models.getProvider(profile.id)?.auth.oauth).toBe(undefined);
  });

  it("resolves OAuth credentials through the provider auth layer", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "carrent-models-"));
    const profile = {
      id: "kimi-oauth",
      type: "kimi-coding" as const,
      credential: {
        type: "oauth" as const,
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.now() + 60 * 60_000,
      },
      baseUrl: "https://api.kimi.com/coding",
      modelId: "k3",
    };
    await saveAgentAuth(
      { version: 1, activeProfileId: profile.id, profiles: { [profile.id]: profile } },
      home,
    );

    const { models, model } = createAgentModels(profile, home, "9.9.9");
    const auth = await models.getAuth(model);
    expect(auth?.source).toBe("OAuth");
    expect(auth?.auth.headers?.Authorization).toBe("Bearer access-token");
    expect(model.headers?.["User-Agent"]).toBe("carrent/9.9.9");
    expect(await models.checkAuth(profile.id)).toEqual({ source: "OAuth", type: "oauth" });

    await models.logout(profile.id);
    expect((await loadAgentAuth(home))?.profiles[profile.id]?.credential).toBe(undefined);
    expect(await models.checkAuth(profile.id)).toBe(undefined);
  });

  it("keeps OpenAI-compatible API keys on the custom endpoint", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "carrent-models-"));
    const profile = {
      id: "openai-local",
      type: "openai-compatible" as const,
      apiKey: "secret",
      baseUrl: "http://127.0.0.1:11434/v1",
      modelId: "local-model",
    };
    await saveAgentAuth(
      { version: 1, activeProfileId: profile.id, profiles: { [profile.id]: profile } },
      home,
    );

    const { models, model } = createAgentModels(profile, home);
    expect(model.baseUrl).toBe(profile.baseUrl);
    expect((await models.getAuth(model))?.auth.apiKey).toBe("secret");
  });

  it("replaces the catalog with a stored model selection and round-trips it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "carrent-models-"));
    const profile = {
      id: "kimi",
      type: "kimi-coding" as const,
      apiKey: "secret",
      baseUrl: "https://api.kimi.com/coding",
      modelId: "k3",
      models: [
        { id: "k3", name: "Kimi K3" },
        { id: "endpoint-only-model", name: "endpoint-only-model" },
      ],
    };
    await saveAgentAuth(
      { version: 1, activeProfileId: profile.id, profiles: { [profile.id]: profile } },
      home,
    );

    // The selection survives a save/load round-trip.
    expect((await loadAgentAuth(home))?.profiles[profile.id]?.models).toEqual(profile.models);

    // The provider exposes exactly the selected models; ids the builtin
    // catalog does not know get a synthesized entry.
    const { models } = createAgentModels(profile, home);
    expect(models.getModels(profile.id).map((item) => item.id)).toEqual([
      "k3",
      "endpoint-only-model",
    ]);
  });
});
