export type RtkGainStats = {
  available: boolean;
  totalCommands: number;
  inputTokens: number;
  outputTokens: number;
  tokensSaved: number;
  efficiency: number;
  lastCheckedAt: string;
  error?: string;
};

export const RTK_AGENT_INSTRUCTION =
  "RTK is enabled. RTK - Rust Token Killer is a token-optimized CLI proxy for shell commands. Always prefix shell commands with `rtk`. Examples: `rtk git status`, `rtk cargo test`, `rtk npm run build`, `rtk pytest -q`. Use `rtk gain` for token savings analytics, `rtk gain --history` for recent command savings history, and `rtk proxy <cmd>` only when raw unfiltered output is required. Do not run the unprefixed command first. If the shell reports that `rtk` is not found, retry the original command without `rtk`.";

export const RTK_AGENTS_BLOCK_START = "<!-- carrent:rtk:start -->";
export const RTK_AGENTS_BLOCK_END = "<!-- carrent:rtk:end -->";

export const RTK_AGENTS_BLOCK = `${RTK_AGENTS_BLOCK_START}
## RTK - Rust Token Killer

${RTK_AGENT_INSTRUCTION}
${RTK_AGENTS_BLOCK_END}`;

export function upsertRtkAgentsBlock(content: string): string {
  const normalizedContent = content.trimEnd();
  const blockPattern = new RegExp(
    `${escapeRegExp(RTK_AGENTS_BLOCK_START)}[\\s\\S]*?${escapeRegExp(RTK_AGENTS_BLOCK_END)}`,
    "u",
  );

  if (blockPattern.test(content)) {
    return content.replace(blockPattern, RTK_AGENTS_BLOCK);
  }

  return normalizedContent
    ? `${normalizedContent}\n\n${RTK_AGENTS_BLOCK}\n`
    : `${RTK_AGENTS_BLOCK}\n`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
