# Make Kimi Code The Primary Runtime

Status: ready-for-agent

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Make Kimi Code the Primary Runtime in Carrent V1. Carrent should detect whether `kimi` is installed, show useful availability/version information, and make the product's default runtime path point at Kimi Code instead of Codex.

Codex, Claude Code, and pi should be closed as unavailable Runtime choices in V1. They should not be runnable from new product flows while Kimi Code is the active V1 path.

Do not delete existing Codex, Claude Code, or pi configuration during this slice. Existing persisted threads/runtime records should continue to load safely, but attempts to run those runtimes should be disabled or produce a clear unavailable state.

## Acceptance criteria

- [ ] Carrent recognizes Kimi Code as a supported Runtime.
- [ ] Kimi Code is the default runtime for new chat/thread flows.
- [ ] Carrent can detect whether the `kimi` command is available locally.
- [ ] Carrent can surface the installed Kimi Code version when available.
- [ ] Missing Kimi Code produces an actionable runtime availability state.
- [ ] Codex, Claude Code, and pi are unavailable from new V1 runtime selection/run flows.
- [ ] Existing Codex, Claude Code, and pi thread/runtime configuration is preserved during migration.
- [ ] Existing persisted records that reference Codex, Claude Code, or pi load safely and do not crash the app.
- [ ] Tests cover default runtime normalization and Kimi availability/version detection behavior.

## Blocked by

None - can start immediately

## Comments
