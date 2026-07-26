# 04 — Thread state and question history

**What to build:** Keep a pending structured question attached to its owning Thread while the user navigates elsewhere, make the waiting state visible in Thread navigation, and preserve resolved questions as compact Agent Activity so later review explains the user's decision.

**Blocked by:** 03 — Multi-question and multi-select interaction

**Status:** done

- [ ] The user can leave a Thread with a pending question without cancelling or moving the request.
- [ ] The originating Thread shows a waiting-for-answer Thread Status with the same attention precedence as waiting for approval.
- [ ] Returning to the Thread restores the same question index, selections, and `Other` drafts.
- [ ] Submitting or skipping clears the waiting status and restores the normal Composer.
- [ ] Completed Agent Activity records show each question and final answer in compact form without repeating unselected options.
- [ ] Skipped and interrupted records are distinguishable from completed answers.
- [ ] Settled question records round-trip through workspace persistence.
- [ ] Persisted pending records hydrate as interrupted and never become actionable without a live Run.
- [ ] Tests cover Thread navigation, status precedence, compact rendering, skip/interruption rendering, and persistence normalization.
