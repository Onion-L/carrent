# 04 - Preserve Run Checklist and tolerate unknown ACP updates

**What to build:** Keep Kimi's existing Run Checklist behavior alongside the new Timeline and make protocol evolution safe. A user can receive plan progress without timeline reordering, and a Kimi CLI that emits an unfamiliar update continues its Run instead of failing the parent Run.

**Blocked by:** 01 - Establish Kimi Timeline for Thinking and message segments

**Status:** done

- [x] A valid ACP `plan` update continues to update the existing Run Checklist.
- [x] A `plan` update ends the current Thinking phase but does not create a message timeline item or reorder existing Thinking, message, or tool items.
- [x] Checklist updates and timeline updates can arrive in the same Run without one suppressing or duplicating the other.
- [x] Empty or otherwise unsupported plan snapshots preserve the existing Checklist validation behavior and do not fail the Run.
- [x] A Run with no `plan` update completes normally and does not require plan support from the current Kimi CLI.
- [x] Unknown ACP session update types are ignored without failing the Run, changing terminal state, or disturbing known timeline items.
- [x] Existing TodoList and valid Run Checklist behavior remains intact, including the fallback activity behavior when no usable Checklist snapshot exists.
- [x] Fake ACP transport tests cover plan ordering, malformed and empty snapshots, absent plans, and unknown update types.

## Comments

Validation:

- `bun run lint`
- `bun run typecheck`
- `bun test electron/chat/kimiAcpChat.test.ts` (118 pass)
- `bun test` (1383 pass)
- `git diff --check`

Review:

- Standards and Spec reviews completed with no findings.
