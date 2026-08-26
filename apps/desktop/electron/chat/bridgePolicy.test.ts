import { describe, expect, it } from "bun:test";

import type { RuntimeCapabilities } from "../../src/shared/runtimeCapabilities";
import { shouldAttachCarrentBridge } from "./bridgePolicy";

const providerNative: RuntimeCapabilities = {
  skillDiscovery: "provider-native",
  hostFileProxy: true,
  hostTerminal: true,
};

const bridgeDiscovered: RuntimeCapabilities = {
  skillDiscovery: "carrent-bridge",
  hostFileProxy: true,
  hostTerminal: true,
};

const plainRequest = { hasAttachments: false, hasLocalPathContexts: false };

describe("shouldAttachCarrentBridge", () => {
  it("attaches for unknown runtimes and unconfirmed versions", () => {
    expect(
      shouldAttachCarrentBridge({
        runtimeCapabilities: bridgeDiscovered,
        localMcpServerEnabled: true,
        omitProviderNativeBridge: true,
        request: plainRequest,
      }),
    ).toBe("attach");
  });

  it("omits when the Local MCP Server is off, regardless of capabilities", () => {
    for (const runtimeCapabilities of [providerNative, bridgeDiscovered]) {
      expect(
        shouldAttachCarrentBridge({
          runtimeCapabilities,
          localMcpServerEnabled: false,
          omitProviderNativeBridge: true,
          request: plainRequest,
        }),
      ).toBe("omit");
    }
  });

  it("attaches for provider-native runs while the omit flag is off", () => {
    expect(
      shouldAttachCarrentBridge({
        runtimeCapabilities: providerNative,
        localMcpServerEnabled: true,
        request: plainRequest,
      }),
    ).toBe("attach");
  });

  it("omits provider-native plain runs only when the omit flag is on", () => {
    expect(
      shouldAttachCarrentBridge({
        runtimeCapabilities: providerNative,
        localMcpServerEnabled: true,
        omitProviderNativeBridge: true,
        request: plainRequest,
      }),
    ).toBe("omit");
  });

  it("keeps host-bound runs on the Bridge even with the omit flag on", () => {
    for (const request of [
      { hasAttachments: true, hasLocalPathContexts: false },
      { hasAttachments: false, hasLocalPathContexts: true },
    ]) {
      expect(
        shouldAttachCarrentBridge({
          runtimeCapabilities: providerNative,
          localMcpServerEnabled: true,
          omitProviderNativeBridge: true,
          request,
        }),
      ).toBe("attach");
    }
  });
});
