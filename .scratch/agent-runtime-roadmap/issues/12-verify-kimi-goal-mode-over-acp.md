# Verify Kimi 0.29.1 Goal Mode over ACP

Status: done
Labels: wayfinder:task
Assignee: codex

## Parent

[Chart Carrent from Kimi-first V1 to automated multi-Runtime workflows](../PRD.md)

## Question

Using the installed Kimi Code 0.29.1 Runtime, what exact ACP requests, updates, available commands, persistence behavior, and failure behavior let Carrent create and observe a Goal, continue it across turns, handle Approval Requests and User Questions, stop it, resume it through Session load/resume and app restart, distinguish completed from blocked or failed, and present completion evidence? Record enough real protocol evidence to decide whether first-class Goal Mode is implementable for V1 and which Goal lifecycle acceptance criteria are honest.

## Blocked by

- [Research Kimi's feature surface beyond Plan and Goal](./11-research-kimi-feature-surface.md)

## Comments

### Resolution - 2026-07-25

The observed protocol report is [`kimi-goal-mode-over-acp.md`](../spike/kimi-goal-mode-over-acp.md), with raw 0.29.1 transcripts and a reusable probe under [`spike/`](../spike/).

Kimi-native Goal Mode is not implementable as honest first-class Carrent V1 behavior over Kimi 0.29.1 ACP. ACP advertises no Goal capability or config mode, does not expose `/goal`, returns `MethodNotFound` for Goal requests, emits no Goal snapshot or lifecycle update, and provides no trustworthy terminal evidence. A real paused Goal survived Kimi process exit, but `session/resume` exposed no Goal state and `session/load` replayed a stale active-Goal reminder without the later paused transition.

The installed account's exhausted quota also exposed a general ACP failure gap: Kimi recorded a provider `403` as a failed turn internally while ACP returned ordinary `{ "stopReason": "end_turn" }` with no error update. Approval Requests and User Questions remain generic turn interactions and do not repair the missing Goal lifecycle contract.

Carrent may preserve Goal tools as generic Kimi tool activity, but must not claim first-class Goal creation, status, stop/resume, restart recovery, or completion evidence over this ACP version. A separate ticket, [Verify Kimi 0.29.1 Goal Mode over the local KAP server](./13-verify-kimi-goal-mode-over-kap.md), now tests the only concrete in-scope alternative surfaced by this result.
