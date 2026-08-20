import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getAgentAuthPath, loadAgentAuth, normalizeAgentAuthFile, saveAgentAuth } from "./auth";

describe("agent auth", () => {
  it("round-trips Provider Profiles through ~/.carrent/agent/auth.json", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "carrent-auth-"));
    await saveAgentAuth(
      {
        version: 1,
        activeProfileId: "anthropic",
        profiles: {
          anthropic: {
            id: "anthropic",
            type: "anthropic",
            apiKey: "secret",
            baseUrl: "https://api.anthropic.com",
            modelId: "claude-test",
            thinking: false,
          },
        },
      },
      home,
    );

    expect(await loadAgentAuth(home)).toEqual({
      version: 1,
      activeProfileId: "anthropic",
      profiles: {
        anthropic: {
          id: "anthropic",
          type: "anthropic",
          apiKey: "secret",
          baseUrl: "https://api.anthropic.com",
          modelId: "claude-test",
          thinking: false,
        },
      },
    });
    expect(JSON.parse(await readFile(getAgentAuthPath(home), "utf8"))).toBeTruthy();
    if (process.platform !== "win32") {
      expect((await stat(getAgentAuthPath(home))).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects invalid Profile IDs and non-HTTP Base URLs", () => {
    const profile = {
      type: "anthropic",
      apiKey: "secret",
      baseUrl: "https://api.anthropic.com",
      modelId: "claude-test",
    };
    expect(
      normalizeAgentAuthFile({
        profiles: { "invalid profile!": profile },
        activeProfileId: "invalid profile!",
      }),
    ).toBe(null);
    expect(
      normalizeAgentAuthFile({
        profiles: { default: { ...profile, baseUrl: "file:///tmp/provider" } },
        activeProfileId: "default",
      }),
    ).toBe(null);
  });

  it("preserves the opt-in thinking flag while defaulting legacy profiles off", () => {
    const profile = {
      type: "openai-compatible",
      apiKey: "secret",
      baseUrl: "https://api.example.com/v1",
      modelId: "thinking-model",
      thinking: true,
    };

    expect(
      normalizeAgentAuthFile({ profiles: { default: profile }, activeProfileId: "default" })
        ?.profiles.default?.thinking,
    ).toBe(true);
  });
});
