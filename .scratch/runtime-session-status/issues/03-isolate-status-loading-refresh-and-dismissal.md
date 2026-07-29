# 03 — Isolate Status loading, refresh, failure, and dismissal

**What to build:** Keep Status requests safely attached to their owning Thread, prevent conflicting Runtime Session operations while a request is active, and preserve truthful panel state through explicit refreshes, failures, dismissal, and context changes.

**Blocked by:** 02 — Complete Status availability and command interaction

**Status:** ready-for-agent

- [ ] Status loading is transient per-Thread state and is not represented as a live Run or persisted across application restart.
- [ ] While Status loads, the affected Thread cannot send, start Compact, or start another Status request.
- [ ] A Status request for one Thread does not block navigation or ordinary use of another Thread.
- [ ] Loading completion and failure update only the owning Thread even if the user navigates elsewhere before the Runtime responds.
- [ ] Every `/status` execution performs one fresh Runtime request; Carrent does not poll, refresh on focus, retry automatically, or schedule background requests.
- [ ] An existing panel snapshot remains visible while an explicit refresh loads, and a successful refresh replaces it atomically.
- [ ] An initial failure opens no empty panel and reports `Unable to load session status.` near the Composer without adding conversation history.
- [ ] A refresh failure preserves the previously loaded snapshot, reports the failure, and restores sending and command availability.
- [ ] Failures preserve Composer draft text and pending attachments and do not retry automatically.
- [ ] The panel closes through its Close control and Escape without blocking Message Timeline reading or scrolling.
- [ ] Sending a new message closes and clears the current Status snapshot before the new Run proceeds.
- [ ] Switching Thread, Runtime, or Project closes and clears the panel so another context never displays the prior Runtime Session.
- [ ] Re-executing `/status` while the panel is open refreshes the snapshot rather than toggling the panel closed.
- [ ] The panel and loading state expose accessible labels, keyboard behavior, and busy state using existing Carrent interaction patterns.
- [ ] Mounted Composer tests cover mutual exclusion, independent Threads, late results, successful refresh, refresh failure, initial failure, Close, Escape, sending, and every context-switch dismissal path.
- [ ] Runtime tests cover success and failure routing, transport or resume failure, no automatic retry, and cleanup of loading state without persistence.
- [ ] Repository lint, typecheck, targeted Runtime tests, and affected Renderer tests pass with the complete Session Status lifecycle enabled.

