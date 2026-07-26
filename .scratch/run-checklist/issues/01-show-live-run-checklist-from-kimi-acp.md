# 01 — Show live Run Checklist from Kimi ACP

**What to build:** Show a read-only Run Checklist above the Composer whenever Kimi emits a valid structured ACP Plan snapshot. The user can inspect every ordered item, see the active position, and expand or collapse the fixed-height scrolling panel without reading duplicate TodoList activity in Thinking.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Kimi ACP `plan` updates produce a Runtime-neutral Run Checklist snapshot bound to the originating Run and Thread.
- [ ] Valid entries preserve Runtime order and map to pending, in-progress, and completed states without parsing reasoning, final answers, Plan Review content, or generic tool output.
- [ ] Each valid snapshot completely replaces the previous snapshot; removed, renamed, reordered, and status-changed entries match the latest Runtime state.
- [ ] Invalid or oversized snapshots are ignored atomically without failing the Run or partially replacing a valid Checklist.
- [ ] A structured empty snapshot clears the live Checklist.
- [ ] The selected Thread displays a progress button immediately above the Composer and automatically expands the panel for the first snapshot of a Run.
- [ ] The progress button toggles the panel with keyboard support and exposes its expanded state accessibly.
- [ ] The panel renders every item, uses a fixed responsive maximum height, and scrolls internally when content overflows.
- [ ] Pending, in-progress, and completed states have distinct familiar icons and accessible text rather than relying on color alone.
- [ ] The progress numerator uses the first in-progress item's one-based position; without an in-progress item it uses the completed count, including zero for a wholly pending list and the total for a wholly completed list.
- [ ] Multiple in-progress items remain visible as active while the first determines the progress numerator.
- [ ] Checklist items are not interactive and cannot be edited, checked, removed, or reordered by the user.
- [ ] Structured Checklist updates display in every Runtime mode without mode-specific filtering.
- [ ] Kimi TodoList activity represented by the Checklist is omitted from Thinking while all unrelated Agent Activity remains unchanged.
- [ ] Tests cover the complete Kimi ACP-to-Composer path, full replacement, progress calculation, disclosure behavior, overflow, malformed snapshots, accessibility, and duplicate-activity suppression through existing public behavior seams.
