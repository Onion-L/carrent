import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { AgentAuthView, SaveAgentAuthRequest } from "../../../shared/agentAuth";
import { ToastProvider } from "../toast/ToastContext";
import { ProviderProfilesPanel } from "./ProviderProfilesPanel";

type AgentAuthMock = {
  load: () => Promise<AgentAuthView>;
  save: (request: SaveAgentAuthRequest) => Promise<AgentAuthView>;
  login?: (profileId: string) => Promise<AgentAuthView>;
};

const emptyView: AgentAuthView = {
  path: "~/.carrent/agent/auth.json",
  activeProfileId: "",
  profiles: [],
};

function viewWith(
  profiles: AgentAuthView["profiles"],
  activeProfileId = profiles[0]?.id ?? "",
): AgentAuthView {
  return { path: "~/.carrent/agent/auth.json", activeProfileId, profiles };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderPanel(agentAuth: AgentAuthMock) {
  window.carrent = { agentAuth } as unknown as Window["carrent"];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ToastProvider, null, createElement(ProviderProfilesPanel)));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonWithText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
  const match = buttons.find((button) => button.textContent?.includes(text));
  if (!match) throw new Error(`Button not found: ${text}`);
  return match;
}

describe("ProviderProfilesPanel", () => {
  it("activates the first connected provider on a fresh install", async () => {
    const savedRequests: SaveAgentAuthRequest[] = [];
    await renderPanel({
      load: async () => emptyView,
      save: async (request) => {
        savedRequests.push(request);
        return viewWith(
          request.profiles.map((profile) => ({
            id: profile.id,
            type: profile.type,
            baseUrl: profile.baseUrl,
            modelId: profile.modelId,
            thinking: false,
            hasApiKey: false,
          })),
          "kimi",
        );
      },
      login: async (profileId) =>
        viewWith(
          [
            {
              id: "default",
              type: "anthropic",
              baseUrl: "https://api.anthropic.com",
              modelId: "claude-sonnet-4-6",
              hasApiKey: false,
            },
            {
              id: profileId,
              type: "kimi-coding",
              baseUrl: "https://api.kimi.com/coding",
              modelId: "k3",
              authType: "oauth",
              hasApiKey: false,
              oauthSupported: true,
            },
          ],
          profileId,
        ),
    });

    await act(async () => buttonWithText("Add Provider").click());
    await act(async () => buttonWithText("Kimi Code").click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0]?.activeProfileId).toBe("kimi");
    expect(savedRequests[0]?.profiles.map((profile) => profile.id)).toEqual(["default", "kimi"]);
  });

  it("keeps the active profile when it already has a credential", async () => {
    const savedRequests: SaveAgentAuthRequest[] = [];
    await renderPanel({
      load: async () =>
        viewWith([
          {
            id: "default",
            type: "anthropic",
            baseUrl: "https://api.anthropic.com",
            modelId: "claude-sonnet-4-6",
            hasApiKey: true,
          },
        ]),
      save: async (request) => {
        savedRequests.push(request);
        return viewWith(
          request.profiles.map((profile) => ({
            id: profile.id,
            type: profile.type,
            baseUrl: profile.baseUrl,
            modelId: profile.modelId,
            thinking: false,
            hasApiKey: profile.id === "default",
          })),
          "default",
        );
      },
      login: async (profileId) =>
        viewWith(
          [
            {
              id: "default",
              type: "anthropic",
              baseUrl: "https://api.anthropic.com",
              modelId: "claude-sonnet-4-6",
              hasApiKey: true,
            },
            {
              id: profileId,
              type: "kimi-coding",
              baseUrl: "https://api.kimi.com/coding",
              modelId: "k3",
              authType: "oauth",
              hasApiKey: false,
              oauthSupported: true,
            },
          ],
          "default",
        ),
    });

    await act(async () => buttonWithText("Add Provider").click());
    await act(async () => buttonWithText("Kimi Code").click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0]?.activeProfileId).toBe("default");
  });

  it("sends previousId when a profile is renamed so credentials carry over", async () => {
    const savedRequests: SaveAgentAuthRequest[] = [];
    await renderPanel({
      load: async () =>
        viewWith([
          {
            id: "kimi",
            type: "kimi-coding",
            baseUrl: "https://api.kimi.com/coding",
            modelId: "k3",
            authType: "oauth",
            hasApiKey: false,
            oauthSupported: true,
          },
        ]),
      save: async (request) => {
        savedRequests.push(request);
        return viewWith(
          request.profiles.map((profile) => ({
            id: profile.id,
            type: profile.type,
            baseUrl: profile.baseUrl,
            modelId: profile.modelId,
            thinking: false,
            hasApiKey: false,
            oauthSupported: true,
          })),
          request.activeProfileId,
        );
      },
    });

    const idInput = document.body.querySelector<HTMLInputElement>("input.field-input")!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      idInput.focus();
      setter.call(idInput, "kimi-work");
      idInput.dispatchEvent(new window.Event("input", { bubbles: true }));
      idInput.dispatchEvent(
        new window.KeyboardEvent("keyup", { bubbles: true, key: "k" }),
      );
    });
    await act(async () => buttonWithText("Save Profiles").click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0]?.profiles[0]).toMatchObject({ id: "kimi-work", previousId: "kimi" });
    expect(savedRequests[0]?.activeProfileId).toBe("kimi-work");
  });
});
