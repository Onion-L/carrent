# Carrent Bridge supports safe skill resources

Status: ready-for-agent

## Parent

.scratch/kimi-skill-bridge/PRD.md

## What to build

Extend Carrent Bridge from top-level skill reads to full read-only skill resource support. A runtime should be able to list and read text resources inside a selected skill root, while Carrent prevents resource reads from escaping that skill's resolved real root.

This slice should support symlinked skill roots deliberately: the Skill Catalog may discover a skill through one declared path while enforcing reads against the resolved real root. Resource symlinks that resolve outside the selected skill root must be rejected. If a resource effectively points to another installed skill, the runtime must read that other skill explicitly through `read_skill`.

## Acceptance criteria

- [ ] `list_skill_resources` returns readable text resources under a selected skill root.
- [ ] `read_skill_resource` returns text content for resources that resolve inside the selected skill's real root.
- [ ] Skill root symlinks are supported by tracking declared path and real path.
- [ ] Resource reads using `../`, absolute paths, or symlinks that resolve outside the selected skill real root are rejected.
- [ ] Direct resource traversal into another skill is rejected, while explicit lookup of that other skill still works.
- [ ] Missing resources, unreadable resources, unsupported binary resources, and path escape attempts return structured errors.
- [ ] Resource size and text decoding behavior are bounded.
- [ ] Tests cover safe reads, rejected escapes, symlinked skill roots, and cross-skill behavior.

## Blocked by

- .scratch/kimi-skill-bridge/issues/01-carrent-bridge-skill-discovery-and-skill-md-reads.md
