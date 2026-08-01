# 04 - Preserve Run Checklist and tolerate unknown ACP updates

**What to build:** Keep Kimi's existing Run Checklist behavior alongside the new Timeline and make protocol evolution safe. A user can receive plan progress without timeline reordering, and a Kimi CLI that emits an unfamiliar update continues its Run instead of failing the parent Run.

**Blocked by:** 01 - Establish Kimi Timeline for Thinking and message segments

**Status:** ready-for-agent

- [ ] A valid ACP `plan` update continues to update the existing Run Checklist.
- [ ] A `plan` update ends the current Thinking phase but does not create a message timeline item or reorder existing Thinking, message, or tool items.
- [ ] Checklist updates and timeline updates can arrive in the same Run without one suppressing or duplicating the other.
- [ ] Empty or otherwise unsupported plan snapshots preserve the existing Checklist validation behavior and do not fail the Run.
- [ ] A Run with no `plan` update completes normally and does not require plan support from the current Kimi CLI.
- [ ] Unknown ACP session update types are ignored without failing the Run, changing terminal state, or disturbing known timeline items.
- [ ] Existing TodoList and valid Run Checklist behavior remains intact, including the fallback activity behavior when no usable Checklist snapshot exists.
- [ ] Fake ACP transport tests cover plan ordering, malformed and empty snapshots, absent plans, and unknown update types.
