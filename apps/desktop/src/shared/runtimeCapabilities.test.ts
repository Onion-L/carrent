import { describe, expect, it } from "bun:test";

import {
  KIMI_PROVIDER_NATIVE_SKILL_VERSIONS,
  resolveRuntimeCapabilities,
} from "./runtimeCapabilities";

describe("resolveRuntimeCapabilities", () => {
  it("classifies probe-confirmed Kimi versions as provider-native", () => {
    for (const version of KIMI_PROVIDER_NATIVE_SKILL_VERSIONS) {
      expect(resolveRuntimeCapabilities({ name: "Kimi Code CLI", version })).toEqual({
        skillDiscovery: "provider-native",
        hostFileProxy: true,
        hostTerminal: true,
      });
    }
  });

  it("falls back to the Carrent Bridge for unknown Kimi versions", () => {
    expect(resolveRuntimeCapabilities({ name: "Kimi Code CLI", version: "0.0.0" })).toEqual({
      skillDiscovery: "carrent-bridge",
      hostFileProxy: true,
      hostTerminal: true,
    });
  });

  it("falls back to the Carrent Bridge for unknown runtimes", () => {
    expect(resolveRuntimeCapabilities({ name: "Other CLI", version: "0.37.2" })).toEqual({
      skillDiscovery: "carrent-bridge",
      hostFileProxy: true,
      hostTerminal: true,
    });
  });

  it("falls back to the Carrent Bridge when agent info is missing", () => {
    expect(resolveRuntimeCapabilities(null)).toEqual({
      skillDiscovery: "carrent-bridge",
      hostFileProxy: true,
      hostTerminal: true,
    });
  });
});
