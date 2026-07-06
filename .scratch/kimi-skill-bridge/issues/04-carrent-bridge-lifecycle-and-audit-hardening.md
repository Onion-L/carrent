# Carrent Bridge run lifecycle is cleaned up and auditable

Status: ready-for-agent

## Parent

.scratch/kimi-skill-bridge/PRD.md

## What to build

Harden Carrent Bridge lifecycle and audit behavior around real Kimi chat runs. A Bridge instance created for a Kimi run should be cleaned up reliably on completion, failure, stop, and startup error paths. Skill reads should remain auditable, and background Kimi status/model checks should not start Bridge servers unless they become real chat runs.

This slice should make the Bridge operationally boring: no leaked local servers, no unnecessary Bridge work for background checks, and no hidden read-only tool calls.

## Acceptance criteria

- [ ] Bridge instances are closed after successful Kimi run completion.
- [ ] Bridge instances are closed after Kimi run failure.
- [ ] Bridge instances are closed after user stop/cancel.
- [ ] Bridge startup errors do not leak partially created server state.
- [ ] Kimi model listing does not start Carrent Bridge.
- [ ] Kimi session status checks do not start Carrent Bridge.
- [ ] Skill read audit records include enough information to identify which tool read which skill or resource during a run.
- [ ] Tests cover completion, failure, stop, startup error, and background status/model paths.

## Blocked by

- .scratch/kimi-skill-bridge/issues/03-pass-carrent-bridge-to-kimi-acp-sessions.md
