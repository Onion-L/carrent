# 02 — Apply Thread and Run lifecycle to Run Checklist

**What to build:** Make the latest Run Checklist behave as current Thread state. It remains available after the owning Run settles, follows the user between Threads without leaking across them, and disappears only when that Thread's next Run begins.

**Blocked by:** 01 — Show live Run Checklist from Kimi ACP.

**Status:** ready-for-agent

- [ ] A completed Run retains its last Checklist snapshot without inferring completion for unfinished items.
- [ ] A failed Run retains its last item states and displays the failed outcome at the panel level.
- [ ] A cancelled Run retains its last item states and displays the cancelled outcome at the panel level.
- [ ] Terminal Run outcomes preserve the user's current expanded or collapsed choice.
- [ ] Typing, editing, or focusing Composer input does not clear the retained Checklist.
- [ ] The next Run `started` event clears the same Thread's retained Checklist before accepting snapshots for the new Run.
- [ ] A new Run that never emits a Checklist leaves the surface absent rather than restoring the previous Run's entries.
- [ ] Late snapshots from an older Run cannot recreate or overwrite a Checklist after a newer Run starts.
- [ ] Project Threads and project-less Threads each own independent Checklist state.
- [ ] Switching away from a Thread and back restores that Thread's entries, Run outcome, and expanded state.
- [ ] The Checklist remains outside Message Timeline history and does not appear in old Assistant Messages.
- [ ] Tests cover completed, failed, and cancelled outcomes, typing versus Run start, stale events, two independent Threads, Thread navigation, and the absence of Message Timeline history.
