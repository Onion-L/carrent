# Kimi Code 0.29.1 Goal Mode over KAP

Status: observed

Observed on 2026-07-25 against the installed Kimi Code CLI 0.29.1.

## Decision

Kimi-native Goal Mode **is available as a first-class local interface through `kimi web` / KAP, but not through ACP**.

KAP 0.29.1 exposes deterministic Goal operations, authoritative snapshots and lifecycle events, restart persistence, completion evidence, Approval Requests, and User Questions. It is a shipped, versioned REST/WebSocket surface rather than a private-file scraping workaround. This makes it technically viable for Carrent V1.

Adopting it means Carrent owns a second Kimi Runtime interface alongside ACP: KAP process startup and shutdown, local Bearer Token handling, Session attachment, WebSocket cursor recovery, and a compatibility gate for each Kimi version. The observation proves 0.29.1 behavior, not cross-version stability.

## Evidence

Raw transcripts:

- [`kap-lifecycle.jsonl`](./output/kap-lifecycle.jsonl)
- [`kap-prepare-restart.jsonl`](./output/kap-prepare-restart.jsonl)
- [`kap-restart.jsonl`](./output/kap-restart.jsonl)
- [`kap-interactions.jsonl`](./output/kap-interactions.jsonl)

Repro client: [`kimi-kap-goal-spike.mjs`](./kimi-kap-goal-spike.mjs).

The dedicated Runtime Session was `session_06f49658-7c64-478a-b52c-d3b96241ff7e`. The temporary KAP server was shut down through its authenticated shutdown endpoint after the probe.

## Server ownership and authentication

`kimi web --port <port> --no-open` binds `127.0.0.1` by default. KAP prints a persistent server Bearer Token at startup and supports explicit token rotation. The probe observed:

- REST base: `/api/v1`
- WebSocket: `/api/v1/ws`
- OpenAPI: `/openapi.json`, version `0.29.1`
- AsyncAPI: `/asyncapi.json`, version `0.29.1`
- Unauthenticated REST: HTTP `401`, KAP code `40101`
- WebSocket auth subprotocol: `kimi-code.bearer.<token>`
- Graceful shutdown: authenticated `POST /api/v1/shutdown`

Carrent should capture the local token from the process it starts and keep it out of project state and logs. This is local server authentication, not a provider API key. Carrent should only shut down a KAP process it owns.

## Session attachment and event recovery

KAP addresses the same persisted Kimi Runtime Session by `session_id`. `GET /sessions/{session_id}/snapshot` returns the Session snapshot plus `as_of_seq` and `epoch`. The WebSocket handshake subscribes to that Session with the cursor `{ seq, epoch }`, giving Carrent a defined reconnect boundary rather than requiring replay-text parsing.

The Goal read endpoint is:

```text
GET /api/v1/sessions/{session_id}/goal
```

The authoritative WebSocket event is `goal.updated`. Its payload contains a nullable snapshot and an optional lifecycle or completion change. Snapshot states are `active`, `paused`, `blocked`, and `complete`.

## Goal operations and observed ordering

Goal creation and control use the Session profile endpoint:

```json
POST /api/v1/sessions/{session_id}/profile
{"agent_config":{"goal_objective":"..."}}

POST /api/v1/sessions/{session_id}/profile
{"agent_config":{"goal_control":"pause|resume|cancel"}}
```

Prompt submission also accepts `goal_objective` and `goal_control`. The profile operations were sufficient for the deterministic probe.

The live lifecycle emitted this ordered sequence:

```text
GET goal -> null
goal.updated -> active
goal.updated -> paused  (change=lifecycle, actor=user)
goal.updated -> active  (change=lifecycle, actor=user)
goal.updated -> active  (turnsUsed=1)
goal.updated -> complete (change=completion, actor=model, turnsUsed=1, tokensUsed=104)
goal.updated -> null     (clear)
```

`complete` is observable before Kimi clears the current Goal. Carrent must consume and persist the completion event rather than relying only on a later `GET /goal`, which correctly returns `null` after clear. `cancel` also clears the Goal; there is no durable `cancelled` Goal state.

## Restart persistence

The restart probe created Goal ID `51bed7c4-7619-41a8-9287-3256448e1622`, paused it, shut down KAP, and restarted the server under normal Bearer authentication. After restart, `GET /goal` returned the same Goal ID, objective, and `paused` snapshot. The probe then cancelled it and observed `GET /goal -> null`.

The persistence belongs to the Kimi Runtime Session, not the Carrent process. Carrent restart recovery therefore requires restarting or reconnecting to KAP, loading the Session snapshot, then resubscribing from its returned cursor.

## Approval Requests and User Questions

KAP does not emit separate `approval.requested` or `question.requested` WebSocket frame types. The actual 0.29.1 contract is:

1. `event.session.work_changed` reports `pending_interaction: "approval" | "question"`.
2. Carrent reads the pending request from `GET /approvals?status=pending` or `GET /questions?status=pending`.
3. Carrent resolves it through `POST /approvals/{approval_id}` or `POST /questions/{question_id}`.
4. `event.session.work_changed` returns through `pending_interaction: "none"` to an idle Session.

The live probe requested `pwd` in Manual mode, received a structured Bash approval, rejected it, and returned to idle without executing the command. It then received an `AskUserQuestion` request with `Pass` and `Fail`, answered `Pass`, and returned to idle.

## Terminal evidence and limits

Live completion evidence is authoritative: the `complete` Goal snapshot includes usage counters and a `completion` change with model actor and stats before clear.

KAP's 0.29.1 AsyncAPI also defines `turn.ended.reason` as `completed`, `cancelled`, `failed`, or `blocked`, with structured `{ code, message, retryable }` error data, and Goal snapshots include `terminalReason`. This closes the failure-observability hole found in ACP at the interface-contract level. A fresh provider failure was not forced during this KAP run, so Carrent's implementation acceptance tests must still exercise a real failed Goal turn before release.

## V1 interface obligations

Carrent may claim first-class Goal Mode over KAP 0.29.1 if V1:

- starts or attaches to loopback KAP and distinguishes owned from external processes;
- handles the local Bearer Token without persisting or logging it as project data;
- keys Goal state to the Kimi Runtime Session ID;
- persists `goal.updated` terminal evidence before the subsequent clear event;
- recovers from WebSocket gaps using snapshot `epoch` and `as_of_seq`;
- routes interactions through `work_changed` plus the Approval/Question REST endpoints;
- rejects unsupported Kimi/KAP versions until their OpenAPI, AsyncAPI, and compatibility probes pass.

ACP can remain the ordinary chat/Plan transport, but it cannot be the source of truth for Goal state. If Carrent does not accept the second-interface obligations above, first-class Goal Mode must stay outside the V1 release bar.
