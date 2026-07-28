# 02 — Complete Compact availability and command interaction

**What to build:** Make Compact appear only when it can act on meaningful current Runtime context, and give menu and direct-command users the same predictable interaction without losing unsent work.

**Blocked by:** 01 — Execute Kimi Compact end to end

**Status:** ready-for-agent

- [ ] The slash menu order is `Plan mode`, `Compact`, then the existing `Skills` group, with no visible Thread Actions heading and no icons on Plan Mode or Compact.
- [ ] Leading slash queries such as `/`, `/c`, and `/co` include Compact in the existing keyboard-navigable filtering behavior.
- [ ] Compact is visible only when the current Runtime advertises support, a resumable Runtime Session exists, the Thread is idle, no Compact is active, and a complete exchange exists after the latest successful Compact for that Runtime.
- [ ] A complete exchange requires a completed Run with both a persisted user request and an effective Agent reply; a completed Plan Review counts.
- [ ] Drafts, queued messages, errors, Run Checklists, failed or cancelled Runs without an effective reply, and Compact dividers do not count as complete exchanges.
- [ ] Compact is available at any reported context usage once all other conditions pass; no percentage threshold is imposed.
- [ ] The Compact row describes the action and current usage with copy equivalent to `Compress this thread's context (34% used)`.
- [ ] Submitting a leading `/compact` with a complete word boundary uses the same Thread Action path as selecting the menu item and never creates a normal Run.
- [ ] The `/compact` token is removed, all following text remains as unsent draft content, and existing attachments remain attached without being passed to the Runtime as Compact input.
- [ ] Manually submitting `/compact` while the Thread is running, already compacting, missing a complete exchange, missing a Runtime Session, or using an unsupported Runtime creates no Run or queued message and shows a concise reason-specific error.
- [ ] A successful Compact remains unavailable until a later completed Run produces another complete exchange for the current Runtime.
- [ ] Renderer integration tests cover menu presentation, keyboard selection, every eligibility branch, Plan Review, direct submission, draft and attachment preservation, unavailable feedback, low context usage, and re-enablement after a new exchange.
