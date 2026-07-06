# Kimi ACP sessions receive Carrent Bridge

Status: ready-for-agent

## Parent

.scratch/kimi-skill-bridge/PRD.md

## What to build

Wire Carrent Bridge into the Kimi ACP Runtime path. When a Kimi chat run creates or resumes an ACP session, Carrent should start or obtain a Bridge instance and pass its HTTP MCP descriptor through `mcpServers` so Kimi Code can discover and call the Bridge tools.

This slice should preserve the existing Kimi ACP approval loop and chat run behavior. Composer skill references remain user intent signals; actual skill content should be available through Bridge tools.

## Acceptance criteria

- [ ] New Kimi ACP sessions receive a non-empty Carrent Bridge HTTP MCP server descriptor.
- [ ] Resumed Kimi ACP sessions receive the same kind of Carrent Bridge descriptor.
- [ ] The descriptor uses the verified HTTP MCP shape: id, name, type, local URL, and headers.
- [ ] Bridge access is local-only and scoped per run or session with a token or similarly narrow URL.
- [ ] A Bridge startup failure produces a useful failed run state.
- [ ] Existing Kimi ACP chat run behavior still emits Carrent chat events rather than ACP-specific renderer data.
- [ ] Fake ACP transport tests assert the `mcpServers` contract for new and resumed sessions.
- [ ] Tests do not require a real Kimi process.

## Blocked by

- .scratch/kimi-skill-bridge/issues/01-carrent-bridge-skill-discovery-and-skill-md-reads.md
