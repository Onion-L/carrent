# 02 — Complete Status availability and command interaction

**What to build:** Make Status discoverable only when the current Thread can safely inspect its existing Runtime Session, and give slash-menu and direct-command users the same predictable behavior without losing unsent work or accidentally invoking the Coding Agent.

**Blocked by:** 01 — Show Kimi Session Status end to end

**Status:** ready-for-agent

- [ ] Status visibility requires an existing Runtime Session mapping and an exact `status` command from the active Runtime Session's advertised commands.
- [ ] Status remains absent for a new Thread, a missing or invalid Session mapping, a Runtime that does not advertise `status`, and disabled non-Kimi V1 Runtimes.
- [ ] Carrent does not launch or create a Runtime Session to probe Status support when capability cannot be established.
- [ ] Status is hidden while the selected Thread has a live Run, an active Compact operation, or an active Status request.
- [ ] Status remains a read-only inspection command and is not persisted or represented as a context-mutating Thread Action.
- [ ] The slash menu order is `Plan mode`, `Compact`, `Status`, then Skills when all entries are available, with existing text-only presentation and no new group heading.
- [ ] Leading slash queries such as `/`, `/s`, and `/st` include Status in the existing keyboard-navigable filtering behavior.
- [ ] Selecting the menu item and submitting a leading `/status` with a complete word boundary use the same non-Run execution path.
- [ ] The `/status` token is removed, all following text remains as unsent Composer draft content, and pending attachments remain attached without being sent to the Runtime.
- [ ] Manually submitting `/status` while unavailable creates no Run, queued message, user message, or Agent prompt and shows `Status is unavailable for this runtime.`
- [ ] Unsupported manual Status submission preserves trailing draft text and attachments.
- [ ] Status capability uses a Carrent-owned allowlist; unknown Runtime commands are not surfaced automatically.
- [ ] Mounted Composer tests cover menu ordering, slash filtering, keyboard selection, every availability branch, direct submission, word boundaries, draft and attachment preservation, and unavailable feedback.
- [ ] Session Manager and IPC tests cover missing mappings, unsupported Runtime requests, deleted Threads, and proof that unavailable requests do not create Sessions or reach normal chat sending.

