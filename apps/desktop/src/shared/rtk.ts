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

export const RTK_MD_CONTENT = `# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy for shell commands.

## Rule

Always prefix shell commands with \`rtk\`.

Examples:

\`\`\`bash
rtk git status
rtk cargo test
rtk npm run build
rtk pytest -q
\`\`\`

## Meta Commands

\`\`\`bash
rtk gain            # Token savings analytics
rtk gain --history  # Recent command savings history
rtk proxy <cmd>     # Run raw command without filtering
\`\`\`

## Verification

\`\`\`bash
rtk --version
rtk gain
which rtk
\`\`\`
`;

export const RTK_AGENTS_BLOCK_START = "<!-- carrent:rtk:start -->";
export const RTK_AGENTS_BLOCK_END = "<!-- carrent:rtk:end -->";

export function getRtkAgentsBlock(rtkMdPath: string): string {
  return `${RTK_AGENTS_BLOCK_START}\n@${rtkMdPath}\n${RTK_AGENTS_BLOCK_END}`;
}

export function upsertRtkAgentsBlock(content: string, rtkMdPath: string): string {
  const normalizedContent = content.trimEnd();
  const blockPattern = new RegExp(
    `${escapeRegExp(RTK_AGENTS_BLOCK_START)}[\\s\\S]*?${escapeRegExp(RTK_AGENTS_BLOCK_END)}`,
    "u",
  );
  const block = getRtkAgentsBlock(rtkMdPath);

  if (blockPattern.test(content)) {
    return content.replace(blockPattern, block);
  }

  return normalizedContent ? `${normalizedContent}\n\n${block}\n` : `${block}\n`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
