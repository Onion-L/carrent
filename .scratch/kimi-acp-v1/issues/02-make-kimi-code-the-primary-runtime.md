# Make Kimi Code The Primary Runtime

Status: done

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Make Kimi Code the Primary Runtime in Carrent V1. Carrent should detect whether `kimi` is installed, show useful availability/version information, and make the product's default runtime path point at Kimi Code instead of Codex.

Codex, Claude Code, and pi should be closed as unavailable Runtime choices in V1. They should not be runnable from new product flows while Kimi Code is the active V1 path.

Do not delete existing Codex, Claude Code, or pi configuration during this slice. Existing persisted threads/runtime records should continue to load safely, but attempts to run those runtimes should be disabled or produce a clear unavailable state.

## Acceptance criteria

- [x] Carrent recognizes Kimi Code as a supported Runtime.
- [x] Kimi Code is the default runtime for new chat/thread flows.
- [x] Carrent can detect whether the `kimi` command is available locally.
- [x] Carrent can surface the installed Kimi Code version when available.
- [x] Missing Kimi Code produces an actionable runtime availability state.
- [x] Codex, Claude Code, and pi are unavailable from new V1 runtime selection/run flows.
- [x] Existing Codex, Claude Code, and pi thread/runtime configuration is preserved during migration.
- [x] Existing persisted records that reference Codex, Claude Code, or pi load safely and do not crash the app.
- [x] Tests cover default runtime normalization and Kimi availability/version detection behavior.

## Blocked by

None - can start immediately

## Comments

Validation:

- `bun test apps/desktop/electron/chat apps/desktop/electron/runtime apps/desktop/src/shared apps/desktop/src/renderer/lib`
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- `bun run build`

Review:

- Subagent review completed.
- Addressed review findings by rejecting legacy runtimes at the lower chat run boundaries and preserving empty persisted legacy runtime selections on open.
