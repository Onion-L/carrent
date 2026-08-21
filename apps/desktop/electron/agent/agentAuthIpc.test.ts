import { describe, expect, it } from "bun:test";

import {
  listProviderModels,
  parseAgentAuthSaveRequest,
  parseListProviderModelsRequest,
} from "./agentAuthIpc";

function request(overrides: Record<string, unknown> = {}) {
  return {
    activeProfileId: "default",
    profiles: [
      {
        id: "default",
        type: "anthropic",
        baseUrl: "https://api.anthropic.com",
        modelId: "claude-test",
        apiKey: "secret",
      },
    ],
    ...overrides,
  };
}

describe("parseAgentAuthSaveRequest", () => {
  it("accepts Anthropic, OpenAI-compatible, and Kimi profiles", () => {
    expect(
      parseAgentAuthSaveRequest(
        request({
          activeProfileId: "openai",
          profiles: [
            request().profiles[0],
            {
              id: "openai",
              type: "openai-compatible",
              baseUrl: "https://api.example.com/v1",
              modelId: "coding-model",
              apiKey: "secret",
            },
          ],
        }),
      ).profiles,
    ).toHaveLength(2);
    expect(
      parseAgentAuthSaveRequest(
        request({
          activeProfileId: "kimi",
          profiles: [
            {
              id: "kimi",
              type: "kimi-coding",
              baseUrl: "https://api.kimi.com/coding",
              modelId: "k3",
              apiKey: "secret",
            },
          ],
        }),
      ).profiles[0]?.type,
    ).toBe("kimi-coding");
  });

  it("rejects duplicate IDs, invalid URLs, and a missing active profile", () => {
    expect(() =>
      parseAgentAuthSaveRequest(
        request({ profiles: [request().profiles[0], request().profiles[0]] }),
      ),
    ).toThrow("unique");
    expect(() =>
      parseAgentAuthSaveRequest(
        request({
          profiles: [{ ...request().profiles[0], baseUrl: "file:///tmp/provider" }],
        }),
      ),
    ).toThrow("HTTP or HTTPS");
    expect(() => parseAgentAuthSaveRequest(request({ activeProfileId: "missing" }))).toThrow(
      "does not exist",
    );
  });

  it("accepts a model selection and rejects malformed entries", () => {
    const withModels = parseAgentAuthSaveRequest(
      request({
        profiles: [
          {
            ...request().profiles[0],
            models: [
              { id: "claude-test", name: "Claude Test" },
              { id: "claude-other", name: "Claude Other" },
            ],
          },
        ],
      }),
    );
    expect(withModels.profiles[0]?.models).toHaveLength(2);
    expect(() =>
      parseAgentAuthSaveRequest(
        request({ profiles: [{ ...request().profiles[0], models: [{ id: 42 }] }] }),
      ),
    ).toThrow("invalid");
  });
});

describe("parseListProviderModelsRequest", () => {
  it("requires a valid type, HTTP(S) base URL, and an API key", () => {
    expect(
      parseListProviderModelsRequest({
        type: "kimi-coding",
        baseUrl: "https://api.kimi.com/coding",
        apiKey: "sk-test",
      }).type,
    ).toBe("kimi-coding");
    expect(() =>
      parseListProviderModelsRequest({ type: "kimi-coding", baseUrl: "file:///tmp", apiKey: "k" }),
    ).toThrow("HTTP or HTTPS");
    expect(() =>
      parseListProviderModelsRequest({
        type: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "  ",
      }),
    ).toThrow("API Key");
  });
});

describe("listProviderModels", () => {
  const request = {
    type: "kimi-coding" as const,
    baseUrl: "https://api.kimi.com/coding",
    apiKey: "sk-test",
  };

  function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
    return (async (url: unknown) => {
      const { status, body } = handler(String(url));
      return {
        ok: status >= 200 && status < 300,
        json: async () => body,
      } as Response;
    }) as typeof fetch;
  }

  it("parses Anthropic-style display names and dedupes ids", async () => {
    const models = await listProviderModels(
      request,
      stubFetch(() => ({
        status: 200,
        body: {
          data: [
            { id: "k3", display_name: "Kimi K3" },
            { id: "k3", display_name: "Kimi K3" },
            { id: "k2-thinking" },
            { nope: true },
          ],
        },
      })),
    );
    expect(models).toEqual([
      { id: "k3", name: "Kimi K3" },
      { id: "k2-thinking", name: "k2-thinking" },
    ]);
  });

  it("falls back to <base>/models when <base>/v1/models fails", async () => {
    const requested: string[] = [];
    const models = await listProviderModels(
      request,
      stubFetch((url) => {
        requested.push(url);
        return url.endsWith("/v1/models")
          ? { status: 404, body: {} }
          : { status: 200, body: { data: [{ id: "m1" }] } };
      }),
    );
    expect(models).toEqual([{ id: "m1", name: "m1" }]);
    expect(requested).toEqual([
      "https://api.kimi.com/coding/v1/models",
      "https://api.kimi.com/coding/models",
    ]);
  });

  it("throws when neither candidate yields a model list", async () => {
    let message = "";
    try {
      await listProviderModels(
        request,
        stubFetch(() => ({ status: 401, body: {} })),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("could not be fetched");
  });
});
