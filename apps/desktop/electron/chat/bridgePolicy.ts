import type { RuntimeCapabilities } from "../../src/shared/runtimeCapabilities";

/**
 * Pure policy deciding whether a Run attaches the per-run Carrent Bridge.
 *
 * The Bridge is the compatibility fallback: only runtimes that are not
 * provider-native for skill discovery (unknown runtimes, unconfirmed Kimi
 * versions) keep it. Provider-native Kimi versions run without it — their
 * skill discovery goes through the provider's own Skill tool, and skill
 * content reads rely on the skill catalog read grant on the ACP fs surface.
 * The Local MCP Server switch and the Run-scoped `carrent_session` question
 * server are independent of this policy.
 */
export type CarrentBridgeAttachment = "attach" | "omit";

export function shouldAttachCarrentBridge(options: {
  runtimeCapabilities: RuntimeCapabilities;
  localMcpServerEnabled: boolean;
}): CarrentBridgeAttachment {
  if (!options.localMcpServerEnabled) {
    return "omit";
  }
  if (options.runtimeCapabilities.skillDiscovery !== "provider-native") {
    return "attach";
  }
  return "omit";
}
