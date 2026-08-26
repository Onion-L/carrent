import type { RuntimeCapabilities } from "../../src/shared/runtimeCapabilities";

/**
 * Pure policy deciding whether a Run attaches the per-run Carrent Bridge.
 *
 * The Bridge is a compatibility and fallback surface: unknown runtimes and
 * unconfirmed Kimi versions always keep it. Provider-native Kimi versions may
 * omit it only behind an explicit grey-release flag, and only for plain Runs
 * without host-bound inputs (attachments, Local Path Context). The Local MCP
 * Server switch and the Run-scoped `carrent_session` question server are
 * independent of this policy.
 */
export type CarrentBridgeAttachment = "attach" | "omit";

export function shouldAttachCarrentBridge(options: {
  runtimeCapabilities: RuntimeCapabilities;
  localMcpServerEnabled: boolean;
  /** Grey-release flag: allow omitting the Bridge for provider-native runs. */
  omitProviderNativeBridge?: boolean;
  request: {
    hasAttachments: boolean;
    hasLocalPathContexts: boolean;
  };
}): CarrentBridgeAttachment {
  if (!options.localMcpServerEnabled) {
    return "omit";
  }
  if (options.runtimeCapabilities.skillDiscovery !== "provider-native") {
    return "attach";
  }
  if (!options.omitProviderNativeBridge) {
    return "attach";
  }
  if (options.request.hasAttachments || options.request.hasLocalPathContexts) {
    return "attach";
  }
  return "omit";
}
