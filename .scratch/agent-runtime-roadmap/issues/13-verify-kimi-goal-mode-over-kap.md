# Verify Kimi 0.29.1 Goal Mode over the local KAP server

Status: done
Labels: wayfinder:task
Assignee: codex

## Parent

[Chart Carrent from Kimi-first V1 to automated multi-Runtime workflows](../PRD.md)

## Question

Using the installed Kimi Code 0.29.1 `kimi web` / KAP localhost interface, is there a stable local Goal lifecycle and event contract Carrent can own without provider SDK integration, direct provider API calls, or Carrent-managed credentials? Record server startup and shutdown ownership, local authentication, Session attachment, Goal create/get/pause/resume/cancel operations, `goal.updated` event ordering and snapshots, Approval Request and User Question routing, persistence across KAP and Carrent restart, terminal failure/completion evidence, and versioning. Decide whether this is a viable V1 interface or unsupported private implementation detail.

## Blocked by

None.

## Comments

### Resolution - 2026-07-25

The observed protocol report is [`kimi-goal-mode-over-kap.md`](../spike/kimi-goal-mode-over-kap.md), with raw 0.29.1 transcripts and a reusable probe under [`spike/`](../spike/).

Kimi-native Goal Mode exists as a first-class local KAP interface, not as ACP. Live tests verified deterministic create/get/pause/resume/cancel operations, ordered `goal.updated` snapshots through completion and clear, restoration of the same paused Goal after KAP restart, rejected shell Approval routing without execution, and answered User Question routing.

KAP ships versioned OpenAPI and AsyncAPI documents and is technically viable for Carrent V1. Carrent must explicitly own the additional interface: loopback KAP process lifecycle, local Bearer Token handling, Session attachment, snapshot/cursor recovery, terminal-event persistence, and per-Kimi-version compatibility tests. The 0.29.1 schema exposes structured failed/blocked turn evidence, but this run only forced the live completion path; a real failed Goal turn remains an implementation acceptance test rather than a reopened roadmap decision.
