# 03 — Isolate Compact lifecycle and failure recovery

**What to build:** Keep an in-flight Compact operation safely attached to its owning Thread while the user navigates elsewhere, and return that Thread to a truthful usable state after success, Runtime failure, invalid Session, timeout, or application shutdown.

**Blocked by:** 01 — Execute Kimi Compact end to end

**Status:** ready-for-agent

- [ ] Compacting is independent transient state per Thread and is not represented internally as a live Run.
- [ ] The owning Thread displays `Compacting` in navigation and in its selected Thread surface while the operation is active.
- [ ] The affected Composer remains editable but cannot send, start another Compact, or expose Thread Actions until the operation settles.
- [ ] The user can navigate to and fully use another Thread while Compact continues for its owner.
- [ ] Completion and failure are routed to the owning Thread even when another Thread is selected.
- [ ] Compact exposes no cancel button, stop control, public cancellation operation, or ACP `session/cancel` request.
- [ ] A Carrent-owned five-minute timeout terminates an unresponsive Compact transport and follows the failure path.
- [ ] ACP errors, process errors, resume rejection, and timeout append no success divider, update no Thread Activity Time, perform no automatic retry, restore normal Composer behavior, and show a concise error.
- [ ] An explicit invalid-session or resume-rejection failure removes only the affected Runtime + Thread Session mapping so the next normal Run can establish a fresh Session from persisted conversation.
- [ ] Non-session failures leave the existing Runtime Session mapping intact.
- [ ] Application shutdown terminates in-flight Compact work; restart restores no compacting state, resumes no operation, and infers no success.
- [ ] Runtime tests cover success routing, all failure types, five-minute timeout with fake timers, lack of cancellation, and isolated invalid-Session cleanup.
- [ ] Renderer integration tests cover `Compacting`, editable-but-unsendable Composer behavior, Thread navigation, use of another Thread, late results for an unselected owner, failure recovery, and absence of Run-only UI.
