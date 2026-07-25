# Current implementation baseline

Observed on 2026-07-25 from the working tree, existing tests, ADRs, and a real local `kimi acp` initialization handshake.

## Stage assessment

Carrent is in late V1: the Kimi-first Runtime path is substantial and locally usable, but V1 has no agreed release bar and still has visible product gaps. V2 has compatibility scaffolding but no enabled second Runtime. V3 orchestration has not started.

## Implemented now

- Kimi Code is the only enabled Runtime and the default for new Threads.
- Kimi runs through ACP over stdio with local detection, version reporting, ACP verification, model listing/selection, mode configuration, cancellation, errors, and Runtime Session continuity per Thread.
- Runs normalize streamed messages, reasoning, shell activity, file/tool activity, approval requests, plan-mode changes, and Kimi-owned Subagent Tasks into Carrent events.
- Approval-required, auto-accept-edits, and full-access postures are modeled. Supported Kimi approval options round-trip through ACP; unsupported flows fail closed.
- Plan Mode and Plan Review return control to the conversation without Carrent pretending that a plan is a generic approval.
- Project and Thread persistence, search, rename, pin/delete actions, queued/steered messages, interrupted-run reconciliation, Thread status, and activity time exist.
- Image and file attachments, immutable stored snapshots, lightbox/history presentation, read-only attachment access, and Kimi image input exist.
- Carrent Bridge exposes installed skills and bounded skill resources through a token-protected local HTTP MCP server with audit records and lifecycle cleanup.
- Workspace diff review, change baselines, branch actions, global agent instructions, and RTK settings exist.

## Evidence and health

- Local Kimi Code: `0.29.1` at `/Users/onion/.kimi-code/bin/kimi`.
- A real `kimi acp` initialization succeeded and advertised session resume/list, image input, embedded context, and HTTP/SSE MCP support.
- `bun run typecheck` passed.
- `bun run lint` passed with zero warnings and errors.
- Targeted Runtime, Chat, Bridge, and Skills tests mostly passed. One Chat Session Manager test fails because an uncommitted package rename changed `apps/desktop/package.json` from the fixture's expected `carrent` name to `@carrent/desktop`; the observed failure is not in the ACP transport.

## V1 gaps and uncertainty

- "Complete Runtime" and "all tools" do not yet have a capability matrix or measurable release criteria, so completeness cannot be asserted.
- Structured Agent questions to the user are planned under `.scratch/kimi-user-questions/` but are not present in the shared Run event contract or renderer flow.
- Existing `.scratch` status is stale: Carrent Bridge and attachment issues remain marked ready while their implementation and tests are already present.
- The real ACP smoke check covered initialization, not a full GUI Run with tool calls, approval, resume, cancellation, attachments, and failure recovery on the current build.
- Current automated coverage is strong around modules but does not establish a packaged-app acceptance suite or a release-quality end-to-end matrix.
- The working tree is already dirty and includes unrelated desktop changes; roadmap work must not treat it as a clean release candidate.

## V2 baseline

- Shared types still name Codex, Claude Code, and pi, and legacy CLI command/event parsing remains tested.
- The V1 Runtime catalog exposes only Kimi, and Chat IPC rejects legacy Runtimes before starting a Run.
- Runtime execution is split between a Kimi-specific ACP path and provider-specific legacy branches, not yet a stable multi-Runtime adapter contract.

## V3 baseline

- Carrent can display Kimi-owned Subagent Tasks, but it does not orchestrate independent Plan and Implement Runtimes.
- There is no workflow state model, cross-Runtime handoff contract, review/repair loop, validation policy, automatic commit policy, or restart/recovery model for a multi-Agent workflow.

## Working sequence

1. Fix the V1 release bar, then audit and close only the gaps required by that bar.
2. Extract and prove a capability-aware Runtime contract with two materially different local Runtimes before broadening the catalog.
3. Build V3 on top of those proven Runtime capabilities: durable workflow state, isolated execution, Plan-to-Implement handoff, Plan review, bounded repair, validation, human intervention, and commit last.
