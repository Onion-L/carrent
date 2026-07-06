# Carrent Bridge exposes skill discovery and SKILL.md reads

Status: ready-for-agent

## Parent

.scratch/kimi-skill-bridge/PRD.md

## What to build

Build the first read-only Carrent Bridge tracer bullet for Skill Catalog access. A runtime-facing MCP client should be able to call the Bridge, list installed skills, and read a selected skill's `SKILL.md` through Carrent-owned APIs rather than prompt-injected skill text.

This slice should produce a working local HTTP MCP Bridge with `list_skills` and `read_skill`. It should use the existing Skill Catalog as the source of truth, add the metadata needed for declared path versus real path, and keep the Bridge runtime-neutral rather than Kimi-specific.

## Acceptance criteria

- [ ] Carrent Bridge can start a local HTTP MCP server and expose a server descriptor suitable for an ACP `mcpServers` entry.
- [ ] `list_skills` returns installed skill metadata needed for runtime discovery, including name, description, source, and stable identity/path metadata.
- [ ] `read_skill` returns a selected skill's `SKILL.md` content and declared/real path metadata.
- [ ] Invalid or missing skills return structured MCP errors.
- [ ] Skill reads are read-only and do not trigger Carrent's interactive approval UI.
- [ ] Skill read calls are logged or recorded through an auditable seam.
- [ ] Tests use fake skill roots and do not depend on the user's real home directory.
- [ ] Tests cover Bridge MCP behavior through its public request surface.

## Blocked by

None - can start immediately
