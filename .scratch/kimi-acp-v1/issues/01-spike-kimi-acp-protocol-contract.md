# Spike Kimi ACP Protocol Contract

Status: done

## Parent

.scratch/kimi-acp-v1/PRD.md

## What to build

Run a focused Kimi ACP spike that proves Carrent can launch `kimi acp`, complete the minimum protocol handshake, submit a prompt, observe streamed output, cancel a run, and document the real protocol behavior Carrent should rely on.

This slice should not integrate the result into the main app yet. Its output is an observed protocol note that future implementation issues can trust.

## Acceptance criteria

- [x] A local spike can start `kimi acp` and perform the minimum initialization required by the protocol.
- [x] The spike submits one prompt against a real project workspace and records the event sequence returned by Kimi Code.
- [x] The spike verifies what ACP exposes for session creation/loading, prompt streaming, completion, cancellation, permission requests, file I/O, and workspace/cwd semantics.
- [x] The spike records clear notes about unsupported, ambiguous, or version-specific protocol behavior.
- [x] The note states which ACP events should map to Carrent chat events in later issues.
- [x] The spike does not require changing the production chat flow.

## Blocked by

None - can start immediately

## Comments

- Observed protocol note: `.scratch/kimi-acp-v1/observed-kimi-acp-protocol.md`
- Repro script: `.scratch/kimi-acp-v1/spike/kimi-acp-spike.mjs`
