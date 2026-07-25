# Chart Carrent from Kimi-first V1 to automated multi-Runtime workflows

Status: needs-info
Labels: wayfinder:map

## Destination

A decision-complete V1-to-V3 product and architecture roadmap with measurable phase gates, ready to be converted into implementation issues without reopening foundational scope, Runtime integration, orchestration, safety, or user-control questions.

## Notes

- Domain context: [Desktop App](../../apps/desktop/CONTEXT.md).
- Observed baseline: [Current implementation baseline](./current-state.md).
- Every session should use `wayfinder`, `grilling`, and `domain-modeling`; use `codebase-design` for Runtime and workflow boundaries and `prototype` for operator-facing interaction decisions.
- Source-of-truth order for current capability claims: working code and tests, then ADRs, then `.scratch` issue status.
- Standing constraints: local CLI, ACP, MCP, or another local protocol only; Carrent does not integrate provider SDKs, call provider APIs directly, or ask users to store provider API keys.
- This map makes decisions only. Implementation begins after the route to the destination is clear.

## Decisions so far

- [Research Kimi's feature surface beyond Plan and Goal](./issues/11-research-kimi-feature-surface.md) — Kimi also has Swarm, Fork, subagents, background tasks, `/btw`, Goal queues, and other facilities, but these span different layers and ACP lacks dedicated Goal, Swarm, Fork, and `/btw` methods.
- [Verify Kimi 0.29.1 Goal Mode over ACP](./issues/12-verify-kimi-goal-mode-over-acp.md) — ACP exposes no usable Goal lifecycle or trustworthy terminal evidence; a real paused Goal survives inside Kimi but is invisible or stale through Session resume/load, so V1 needs another local interface or a scope change.
- [Verify Kimi 0.29.1 Goal Mode over the local KAP server](./issues/13-verify-kimi-goal-mode-over-kap.md) — KAP exposes a versioned, restart-safe Goal lifecycle and interaction contract suitable for V1, provided Carrent owns its process, local Bearer authentication, cursor recovery, terminal-event persistence, and version compatibility.

## Not yet specified

- Runtime-specific setup, authentication, upgrade, diagnostics, and failure recovery. This becomes precise after the first V2 Runtimes and integration contract are chosen.
- V3 routing policy for model quality, price, context limits, and fallback. This depends on the orchestration state model and the capabilities actually exposed by V2 Runtimes.
- Workflow persistence, restart recovery, parallelism, and workspace isolation details. These depend on the ownership and handoff model.
- Exact operator UI for progress, intervention, failed validation, review rejection, and recovery. This becomes precise after the workflow contracts are fixed and a prototype is reviewed.
- Distribution, update, telemetry, and support requirements if the V1 release bar expands beyond the current developer-operated product.

## Out of scope

- Direct provider SDK or API integration and Carrent-managed provider API keys.
- Implementing V1 gaps, additional Runtimes, or V3 orchestration while working this map.
- A Carrent-owned Agent Loop; each Runtime continues to own its model/tool loop.
- Hosted or remote Carrent execution infrastructure unless the destination is explicitly redrawn.
