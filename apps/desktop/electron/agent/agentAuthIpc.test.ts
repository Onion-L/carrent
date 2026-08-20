import { describe, expect, it } from "bun:test";

import { parseAgentAuthSaveRequest } from "./agentAuthIpc";

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
});
