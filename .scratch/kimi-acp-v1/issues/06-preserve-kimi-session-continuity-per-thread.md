# Preserve Kimi Session Continuity Per Thread

Status: done

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Preserve Kimi Code session continuity per Carrent thread once the ACP spike confirms the relevant session semantics. A user should be able to continue a thread and have Kimi Code receive the correct prior context without Carrent guessing unsupported resume behavior.

## Acceptance criteria

- [x] The implementation follows the session semantics verified in the ACP spike.
- [x] A Kimi session is associated with the correct Carrent thread and workspace.
- [x] A second message in the same thread continues the intended Kimi context.
- [x] A different thread does not accidentally reuse the wrong Kimi context.
- [x] Failed runs do not persist a session in a way that corrupts later turns.
- [x] Tests cover same-thread continuation, different-thread isolation, and failed-run behavior.

## Blocked by

- .scratch/kimi-acp-v1/issues/03-run-one-kimi-acp-chat-turn-end-to-end.md

## Comments
