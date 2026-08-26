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

describe("shouldAttachCarrentBridge", () => {
  it("attaches for unknown runtimes and unconfirmed versions", () => {
    expect(
      shouldAttachCarrentBridge({
        runtimeCapabilities: bridgeDiscovered,
        localMcpServerEnabled: true,
      }),
    ).toBe("attach");
  });

  it("omits when the Local MCP Server is off, regardless of capabilities", () => {
    for (const runtimeCapabilities of [providerNative, bridgeDiscovered]) {
      expect(
        shouldAttachCarrentBridge({
          runtimeCapabilities,
          localMcpServerEnabled: false,
        }),
      ).toBe("omit");
    }
  });

  it("omits the Bridge for provider-native runs", () => {
    expect(
      shouldAttachCarrentBridge({
        runtimeCapabilities: providerNative,
        localMcpServerEnabled: true,
      }),
    ).toBe("omit");
  });
});
