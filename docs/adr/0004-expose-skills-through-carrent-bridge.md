# Expose skills through Carrent Bridge

Carrent exposes the Skill Catalog through a Carrent-owned HTTP MCP server, the Carrent Bridge. The bridge provides explicit read-only tools (`list_skills`, `read_skill`, `list_skill_resources`, and `read_skill_resource`) for runtimes and external MCP clients that need Carrent-managed skill discovery or resource reads.

Kimi Code is an exception to the discovery assumption: current Kimi ACP versions discover and read skills through their own provider-owned `Skill` tool. Carrent may still attach the Bridge to Kimi sessions for compatibility and future provider versions, but Kimi skill reads are not required to pass through the Bridge and are not included in Carrent Bridge audit entries.

## Consequences

The Carrent Bridge is a runtime capability surface, not a Kimi-specific integration. Reads made through the Bridge are pre-authorized read-only operations with audit logging; provider-owned reads are outside that audit surface. Future Bridge tools that execute scripts, write files, or access the network must use Carrent's interactive approval flow. Skill directory symlinks are allowed when the catalog resolves and records the real skill root, but resource reads must stay inside that real root; crossing to another skill requires an explicit skill read.
