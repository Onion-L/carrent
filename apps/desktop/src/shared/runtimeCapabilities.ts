/**
 * Runtime capability contract: describes how a runtime obtains skills and
 * which host surfaces Carrent offers it. A capability snapshot describes
 * observed behavior only — it never grants permissions. File and terminal
 * access stay enforced by the host handlers, allowlists, and approval flow.
 */
export type RuntimeSkillDiscovery = "provider-native" | "carrent-bridge" | "none";

export type RuntimeCapabilities = {
  /** How the runtime discovers and reads skills. */
  skillDiscovery: RuntimeSkillDiscovery;
  /** Carrent proxies file reads/writes for the runtime (ACP `fs`). */
  hostFileProxy: boolean;
  /** Carrent offers host terminals to the runtime (ACP `terminal`). */
  hostTerminal: boolean;
};

export type RuntimeAgentInfo = {
  name: string;
  version: string;
};

/**
 * Kimi Code CLI versions confirmed to discover and read project/user skills
 * through their provider-owned `Skill` tool without using the Carrent Bridge.
 * 0.37.2 was confirmed by the original ad-hoc probe; 0.38.0 by the archived
 * matrix (`scripts/verification/skill-visibility-probe.ts`). Any version not
 * listed here is treated as unknown.
 *
 * Confirmation scope: `.agents/skills` roots (project and user). The 0.38.0
 * matrix showed Kimi does not reliably discover `.codex/skills` roots and
 * scans deeper than the Skill Catalog, so the Bridge stays attached by
 * default even for these versions (see plans/verification-skill-visibility-probe.md).
 */
export const KIMI_PROVIDER_NATIVE_SKILL_VERSIONS: readonly string[] = ["0.37.2", "0.38.0"];

/**
 * Classifies a runtime from its ACP `agentInfo`. Unknown runtimes and unknown
 * Kimi versions get the conservative profile: keep the Carrent Bridge
 * attached and do not assume provider-native skill discovery.
 */
export function resolveRuntimeCapabilities(
  agentInfo: RuntimeAgentInfo | null,
): RuntimeCapabilities {
  if (
    agentInfo?.name === "Kimi Code CLI" &&
    KIMI_PROVIDER_NATIVE_SKILL_VERSIONS.includes(agentInfo.version)
  ) {
    return { skillDiscovery: "provider-native", hostFileProxy: true, hostTerminal: true };
  }

  return { skillDiscovery: "carrent-bridge", hostFileProxy: true, hostTerminal: true };
}
