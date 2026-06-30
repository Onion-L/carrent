# Pass Model Profile Configuration Through Kimi Runtime

Status: done

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Pass model and Provider Profile configuration through the Kimi Runtime using Kimi Code's supported mechanisms. Carrent should configure the selected Runtime without becoming a Direct API Agent or storing secret API keys.

This slice should stay narrow: support the minimum model/profile pass-through needed for Kimi Code, and leave broader Provider Profile management for later product work.

## Acceptance criteria

- [x] Carrent can pass a selected Kimi-supported model into a Kimi run if the verified ACP/runtime path supports it.
- [x] Carrent does not call provider APIs directly for this feature.
- [x] Secret API keys are not stored in Carrent workspace data.
- [x] Unsupported model/profile configuration produces a clear error or disabled state.
- [x] Existing thread runtime model persistence continues to work for the Kimi path.
- [x] Tests cover supported model pass-through and unsupported configuration handling.

## Blocked by

- .scratch/kimi-acp-v1/issues/03-run-one-kimi-acp-chat-turn-end-to-end.md

## Comments
