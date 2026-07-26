# 01 — ACP adapter masks failed turns as `end_turn` (provider errors never reach clients)

**What to build:** Upstream bug report for the Kimi Code CLI team. Submit it,
track the response, and remove the client-side guesswork once fixed.

**Blocked by:** None — can start immediately

**Status:** ready-for-human

## Summary

When a turn fails with a provider error (e.g. `403` quota exhausted), Kimi
Code's ACP adapter resolves `session/prompt` with
`stopReason: "end_turn"` — indistinguishable from a normal completion. The
error payload is dropped; it is only written to Kimi's own `kimi-code.log`.
ACP clients therefore render failed runs as successfully completed and never
surface the error to the user.

## Evidence

Two occurrences on 2026-07-25 (both `model=k3`):

```
09:55:51Z  WARN llm request failed turnStep=0.16 attempt=1/10 model=k3
           errorName=APIStatusError statusCode=403
           errorMessage="403 You've reached your usage limit for this billing
           cycle. Your quota will be refreshed in the next cycle. ..."
09:55:51Z  ERROR turn failed turnId=0
09:55:51Z  WARN acp: turn ended with failed reason
           error={"code":"provider.api_error","message":"403 ...",...}
```

(same pattern again at 11:04:32Z in a second session)

Client-side effect (Carrent, an ACP client): the run rendered as
**"Completed · 4m 18s"** with no error and no final answer, even though the
turn died mid-work.

Root cause, extracted from the kimi 0.29.1 binary (`app_version=0.29.1`):

```js
function turnEndReasonToStopReason(reason, error) {
  switch (reason) {
    case "completed": return "end_turn";
    case "cancelled": return "cancelled";
    case "failed":
      if (error?.code === "provider.filtered") return "refusal";
      return "end_turn"; // ← all other failures, incl. 403 quota exhaustion
    case "blocked": return "refusal";
  }
}
```

The `turn.ended` handler resolves the prompt with that `stopReason` and
drops `event.error`. Only auth errors reject; every other failure is masked:

```js
if (event.type === "turn.ended") {
  if (settled) return;
  settled = true;
  if (event.reason === "failed") {
    log.warn("acp: turn ended with failed reason", {
      sessionId,
      error: event.error,
    });
    const authErr = authRequiredFromPayload(event.error);
    if (authErr) {
      reject(authErr); // auth errors surface as request failures
      return;
    }
  }
  // Non-auth failures fall through and resolve "normally":
  resolve({ stopReason: turnEndReasonToStopReason(event.reason, event.error) });
}
```

## Impact

- Clients cannot distinguish "turn completed" from "turn died of a provider
  error" — the terminal `session/prompt` response is indistinguishable.
- Quota exhaustion, rate limiting, and provider 5xx are invisible in every
  ACP client UI. Users see a "completed" run with a missing answer and no
  explanation.

## What the client receives

Wire timeline for the 09:55:51Z failure (from the session's `wire.jsonl`):

```
17:51:33  turn.prompt (run starts)
17:51:44  … 15 model steps: reads, edits, commentary …
17:55:51  llm.request (step 16) → provider returns 403 (quota exhausted)
17:55:51  turn failed — recorded in kimi-code.log only; no wire event
          carries the error
```

The terminal `session/prompt` response the client sees (reconstructed from
the adapter source — the response carries no error field at all):

```json
{ "jsonrpc": "2.0", "id": 7, "result": { "stopReason": "end_turn" } }
```

## Suggested fix

Reject the `session/prompt` JSON-RPC request with the provider error (code +
message), the same way auth errors already reject via
`authRequiredFromPayload`. ACP's `stopReason` enum (`end_turn` /
`max_tokens` / `max_turn_requests` / `refusal` / `cancelled`) has no "error"
value, so rejection is the existing protocol-native structured failure
channel that preserves the error message.

## Acceptance criteria for the upstream fix

- A non-auth `failed` turn (provider 4xx/5xx, quota exhaustion, rate limit)
  rejects the `session/prompt` request with a JSON-RPC error whose message
  carries the provider error text.
- `provider.filtered` failures still resolve with `stopReason: "refusal"`.
- User-cancelled turns still resolve with `stopReason: "cancelled"`.

## Reproduction

1. Drive any ACP `session/prompt` until the provider errors (e.g. exhaust
   the billing-cycle quota).
2. Observe the request resolve normally with `stopReason: "end_turn"` while
   `kimi-code.log` records `turn failed` / `acp: turn ended with failed
   reason`.

## Environment

kimi 0.29.1 (Mach-O arm64), macOS 15, ACP over stdio.

## Comments

- 2026-07-26: Report drafted with log excerpts, the session wire timeline,
  and the decompiled ACP adapter source (`turnEndReasonToStopReason` and the
  `turn.ended` handler). Client-side error display (error card + explicit
  `stopReason` handling for `refusal` etc.) is being implemented in Carrent
  independently; it can only surface errors the protocol actually delivers,
  so this upstream fix is still required for provider failures.
