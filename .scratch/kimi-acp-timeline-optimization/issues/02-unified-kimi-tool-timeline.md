# 02 - Add the unified Kimi Tool Timeline

**What to build:** Show every Kimi tool call, including shell and generic tools, as one inspectable timeline item. A user can see the tool title and kind, follow its input and output, and understand whether it is pending, running, completed, or failed without duplicate cards or overwritten parallel calls.

**Blocked by:** 01 - Establish Kimi Timeline for Thinking and message segments

**Status:** done

- [x] The first `tool_call` for a tool creates one tool timeline item at its first-seen order.
- [x] `tool_call_update` with the same `toolCallId` updates that item in place and never moves it to the end of the timeline.
- [x] An update that arrives before its start creates a temporary item that is completed with later title, kind, input, output, and status data.
- [x] Different tool ids, including concurrent calls, remain independent and cannot overwrite one another.
- [x] Missing tool ids receive unique Run-scoped ids derived from the Run and event sequence; no fixed fallback id is reused.
- [x] Shell and generic tools use the same timeline contract and renderer path, while shell command details remain available when present.
- [x] Tool input, output, error, title, kind, and status are retained, with output and failure details visible in the tool item.
- [x] Normal ACP tool states map to pending, running, completed, or failed without treating a generic tool as a Thinking item.
- [x] Tool updates end the current Thinking phase but preserve the already assigned timeline order.
- [x] Fake ACP transport and renderer tests cover repeated updates, update-before-start, parallel ids, missing ids, generic tools, shell tools, output, and failure display.

## Comments

Scope boundary: the cancelled-on-stop sweep, authoritative `isFinal`/stopReason terminal mapping, and late-event suppression are intentionally deferred to issue 03 (which is blocked by this issue). The basic status-regression guard (a completed/failed tool is not flipped back to running by a later ordinary update) is implemented here so parallel tool ids cannot overwrite one another; issue 03 formalizes the full terminal sweep. Persistence hydration of tool items is added for forward compatibility (issue 05 owns full replay durability/idempotency).

Validation:

- `bun run lint`
- `bun run typecheck`
- `bun test` (1370 pass)
- `git diff --check`

Review:

- Standards and Spec reviews completed. The one real Spec gap they surfaced (`pending` tool status was unreachable dead code) and the matching Speculative Generality smell were fixed: ACP `pending` now maps to the timeline `pending` state (kimiAcpChat.test.ts covers pending/running/completed/failed). Remaining Standards notes are judgement calls (renderer `describeKimiToolActivity`/`capitalize` mirror the adapter's presentation helpers; `toolStates` retains its legacy fallback role) and are out of scope for this issue.
