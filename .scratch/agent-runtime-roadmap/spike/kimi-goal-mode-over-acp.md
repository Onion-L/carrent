# Kimi Code 0.29.1 Goal Mode over ACP

Status: observed

Observed on 2026-07-25 against the installed Kimi Code CLI 0.29.1.

## Decision

Kimi-native Goal Mode is **not implementable as honest first-class Carrent V1 behavior over Kimi 0.29.1 ACP**.

ACP can preserve ordinary Kimi tool compatibility, but it has no Goal capability, command, request, snapshot, lifecycle update, or terminal evidence contract. A Goal stored inside a Kimi Runtime Session survives process restart, yet ACP cannot distinguish its current `active`, `paused`, `blocked`, or completed state. Carrent must either use a different supported local Kimi protocol or remove first-class Goal Mode from the V1 release bar.

## Live ACP observations

Raw transcripts:

- [`commands.jsonl`](./output/commands.jsonl)
- [`existing-goal.jsonl`](./output/existing-goal.jsonl)
- [`goal-denied.jsonl`](./output/goal-denied.jsonl)

Repro client: [`kimi-goal-acp-spike.mjs`](./kimi-goal-acp-spike.mjs).

### Initialization and discovery

`initialize` advertised protocol version 1, Session load/list/resume, prompt image and embedded-context support, MCP HTTP/SSE, and terminal authentication. It advertised no Goal capability.

`session/new` returned only the `model`, `thinking`, and `mode` config options. Mode values were `default`, `plan`, `auto`, and `yolo`; Goal is not a mode value.

The first `available_commands_update` contained six ACP built-ins plus dynamically discovered Skills:

```text
compact, status, usage, mcp, tasks, help, <skills...>
```

It contained no `goal` command. Sending this ordinary ACP prompt:

```json
{
  "method": "session/prompt",
  "params": {
    "sessionId": "<id>",
    "prompt": [{ "type": "text", "text": "/goal status" }]
  }
}
```

produced an `agent_message_chunk` containing:

```text
Unknown ACP command: /goal. Use /help to see available commands.
```

The prompt then returned `{ "stopReason": "end_turn" }`.

### No Goal RPC surface

The following requests all returned JSON-RPC error `-32601` (`Method not found`):

```text
session/get_goal
session/create_goal
session/pause_goal
session/resume_goal
session/cancel_goal
goal/get
ext/goal
```

The installed adapter implements the ACP extension surface as a `MethodNotFound` stub. There is no alternative namespaced Goal method advertised by `initialize`.

### Persistence and app restart

A real Goal was created in the Kimi 0.29.1 TUI under Auto mode, with objective:

```text
Emit GOAL_TUI_PROBE over three distinct goal turns, then mark complete. Do not access files or run shell commands.
```

Kimi's persisted Runtime records contained:

```text
goal.create
goal.update turnsUsed=1
goal.update status=paused reason="Paused after provider API error: 403 ... usage limit ..."
```

The TUI also displayed the Goal as `paused` after the provider failure. This proves that Runtime-owned Goal state survived the failed turn and the TUI process exiting.

A new `kimi acp` process then called `session/resume` for the same Runtime Session. The response contained only config options. It reported mode `default`, while a subsequent `/status` on that same resumed Session reported permission `auto`; the restored config response and live status therefore disagreed about the safety posture. `/status` reported model, thinking, permission, Plan Mode, and context usage, but no Goal. `/goal status` remained unknown and `session/get_goal` remained `MethodNotFound`.

A second new `kimi acp` process called `session/load`. Before the response it replayed three `user_message_chunk` updates: the original objective, the old active-Goal system reminder, and the Auto-mode reminder. It did **not** replay a current Goal snapshot or the later paused transition. The replayed reminder still said `Status: active`, so parsing replay text would produce stale, incorrect state.

Therefore:

- `session/resume` preserves the Runtime Session but exposes no Goal state.
- `session/load` replays partial historical text, not authoritative Goal state.
- Carrent cannot safely infer Goal state from replayed reminders or tool text.
- App restart continuity exists inside Kimi, but not at the ACP interface Carrent can observe.

### Provider failure behavior

Both configured K3 and K2.7 models returned Kimi account error `403` because the current billing-cycle usage limit was exhausted. Kimi's private Runtime log recorded `turn.ended` with `reason: "failed"` and code `provider.api_error`.

ACP exposed neither the error payload nor a failure update. `session/prompt` returned:

```json
{ "stopReason": "end_turn" }
```

Carrent therefore cannot distinguish this provider failure from a successful ordinary turn using the observed ACP response. This alone prevents an honest Goal terminal-state contract.

## Installed Runtime behavior not exposed by ACP

Inspection of the installed 0.29.1 executable confirms that Kimi's internal Goal model is richer than ACP:

- Goal states are `active`, `paused`, `blocked`, and transient `complete` followed by clear.
- An active Goal is normalized to `paused` after Runtime resume.
- Turn cancellation pauses an active Goal rather than cancelling it permanently.
- `blocked` is resumable; `/goal cancel` clears the durable Goal and has no `cancelled` state.
- Completion includes turns, tokens, elapsed time, reason, and validation-oriented final messaging.
- Kimi publishes an internal `goal.updated` event with a snapshot and change record.

The ACP session-update schema in the same executable has content, thought, tool, plan, command, mode, config, session-info, and usage updates. It has no Goal update variant. ACP's per-prompt event subscription resolves on the current `turn.ended`; later Runtime-owned Goal continuations have no durable host subscription or Goal update channel.

## Approval Requests and User Questions

These remain generic ACP interactions rather than Goal lifecycle operations:

- Outside Auto mode, model-driven `CreateGoal` uses `session/request_permission`. The installed adapter offers `Switch to Auto and start`, `Switch to YOLO and start`, `Start in Manual`, and `Do not start`, mapped back to Kimi's selected Goal permission mode.
- `AskUserQuestion` also uses `session/request_permission` because ACP has no question method. Option IDs use a question namespace. The adapter degrades multiple questions to the first and multi-select to single-select.
- A dropped, failed, or timed-out Approval Request is rejected. A failed User Question request is dismissed.

Live Goal-start and question requests could not be produced because every configured model shares the exhausted Kimi quota. Even when available, these generic requests would let Carrent answer the current Agent turn; they would not provide Goal status, continuation ownership, completion evidence, or restart recovery.

## Honest V1 acceptance criteria

Carrent can honestly require the following from 0.29.1 ACP:

- Ordinary Runs, Plan Mode, Session continuity, cancellation, generic tool activity, Approval Requests, and the current degraded User Question bridge.
- Goal-related Kimi tools must remain visible and non-crashing if the model invokes them during an ACP prompt.
- A stopped ACP prompt is `cancelled`; Carrent must not claim that this cancelled or completed the underlying Goal.

Carrent cannot honestly claim any of the following over 0.29.1 ACP:

- Create, inspect, pause, resume, cancel, replace, or queue a Goal through a deterministic host operation.
- Observe automatic Goal continuation across Runtime turns.
- Distinguish Goal completion, blocked, paused, provider failure, or ordinary end-of-turn from authoritative structured state.
- Recover current Goal state after `session/load`, `session/resume`, or app restart.
- Present trustworthy completion evidence or Goal usage statistics.

First-class Goal Mode requires a local interface that exposes explicit Goal operations plus an authoritative `goal.updated` snapshot/change stream. Model-prompt conventions, parsing assistant text, scraping Kimi's private files, or interpreting replayed system reminders are not acceptable interfaces.
