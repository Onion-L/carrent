# Use Kimi Code as the V1 primary runtime

Carrent V1 will optimize around Kimi Code as the primary runtime instead of trying to make Codex, Claude Code, pi, and API-based providers equally first-class. Carrent's product promise is a good GUI for coding agents, not a new coding agent implementation; focusing on one runtime keeps V1 small enough to make the agent GUI experience excellent before widening compatibility.

## Considered Options

- **Kimi Code primary runtime**: Chosen because it has no dominant desktop GUI in Carrent's target workflow, supports non-interactive prompt mode, stream JSON output, model selection, provider management, and an ACP server path.
- **Codex or Claude Code primary runtime**: Rejected for V1 focus because both already have strong first-party experiences, and Carrent would compete more directly with existing GUI/TUI surfaces.
- **Multiple runtimes as first-class V1 support**: Rejected because runtime compatibility work would dominate the product before the core GUI experience is proven.
- **Direct API agent**: Rejected because Carrent would need to own the agent loop, tool calling, permissions, local file edits, shell execution, session continuity, and error recovery.

## Consequences

For V1, Codex, Claude Code, and pi are disabled as available runtimes while their existing configuration and persisted thread data remain readable. Provider/profile work should be designed around configuring the selected runtime, not around Carrent becoming a general API client.
