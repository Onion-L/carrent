# Expose skills through Carrent Bridge

Carrent will keep Kimi Code connected through ACP and attach a Carrent-owned HTTP MCP server, the Carrent Bridge, to every Kimi ACP session. The bridge exposes the Skill Catalog through explicit read-only tools (`list_skills`, `read_skill`, `list_skill_resources`, and `read_skill_resource`) instead of injecting all skill content into prompts, preserving ACP's approval loop while letting runtimes discover and load Carrent-managed skills on demand.

## Consequences

The Carrent Bridge is a runtime capability surface, not a Kimi-specific integration. Skill reads are pre-authorized read-only operations with audit logging; future bridge tools that execute scripts, write files, or access the network must use Carrent's interactive approval flow. Skill directory symlinks are allowed when the catalog resolves and records the real skill root, but resource reads must stay inside that real root; crossing to another skill requires an explicit skill read.
