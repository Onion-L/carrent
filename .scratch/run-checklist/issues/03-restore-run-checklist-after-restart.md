# 03 — Restore Run Checklist after app restart

**What to build:** Persist each Thread's latest retained Run Checklist so reopening Carrent restores the same progress surface until the Thread starts another Run. Invalid persisted data must not produce a partial or misleading Checklist.

**Blocked by:** 02 — Apply Thread and Run lifecycle to Run Checklist.

**Status:** ready-for-agent

- [ ] Workspace persistence round-trips valid Checklist entries, owning Run and Runtime identity, panel-level Run outcome, and expanded state.
- [ ] Restoration works for both project Threads and project-less Threads.
- [ ] Reopening Carrent displays the restored Checklist above the selected Thread's Composer without requiring ACP Session history replay.
- [ ] A restored terminal Checklist remains visible until that Thread's next Run starts.
- [ ] Persisted snapshots enforce bounded item counts and content sizes consistent with existing workspace normalization practices.
- [ ] A malformed, unknown-state, or over-limit persisted Checklist is rejected as a whole rather than partially restored.
- [ ] Older workspace snapshots without Checklist state continue to load normally.
- [ ] Restoration does not fabricate a Checklist for a Runtime Session that Carrent never observed and persisted.
- [ ] Tests cover valid round trips, both Thread kinds, expanded and terminal states, old snapshots, malformed data, oversized data, and restoration followed by next-Run clearing.
