# 04 — Notify after queued work becomes idle

**What to build:** Keep completion notifications truthful when a Thread automatically continues through queued messages by suppressing intermediate Run completion and notifying only after the queued sequence is actually idle.

**Blocked by:** 01 — Notify background Run outcomes

**Status:** ready-for-agent

- [x] A successful Run does not create a completion notification when the owning Thread has a queued message that will automatically start another Run.
- [x] Automatically continuing through several queued messages produces no intermediate completion notifications.
- [x] The final successful Run creates one completion notification after no automatically continuing queued message remains.
- [x] Queue inspection uses authoritative shared App State rather than Renderer-local presentation state.
- [x] A queued message that requires explicit user confirmation is not treated as automatically continuing work.
- [x] Failure during a queued sequence still creates a failure notification immediately.
- [x] Cancellation during a queued sequence remains silent.
- [x] Queue-aware notification behavior does not change queue ordering, steering, recovery, or automatic-send semantics.
- [x] Peer Carrent Windows cannot race to produce a completion notification during queue handoff.
- [x] Tests cover one and several automatically continuing messages, final queue drain, confirmation-required queued work, failure, cancellation, and repeated authoritative publication at the Main Process coordinator boundary.
