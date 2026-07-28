# 04 — Persist Compact history and domain lifecycle

**What to build:** Preserve every confirmed Compact boundary as durable Carrent-owned Thread history, keep Thread ordering and future availability correct across navigation and restart, and finish the domain and regression contracts for the new Thread Action lifecycle.

**Blocked by:** 02 — Complete Compact availability and command interaction; 03 — Isolate Compact lifecycle and failure recovery

**Status:** ready-for-agent

- [ ] A successful Compact appends a dedicated Thread Action history record distinct from user messages, Agent messages, Runs, Agent Activity, and Tool Activity.
- [ ] The record has stable identity, owning Thread, Compact action kind, Runtime provenance, and completion time while rendering only the agreed generic `Context compacted` label.
- [ ] The Message Timeline renders the record as a horizontal divider with centered text and no avatar, bubble, icon, visible timestamp, Runtime output, or success Toast.
- [ ] The Thread Action record is excluded from Runtime transcripts, complete-exchange detection, Run reconstruction, conversation-message editing, and conversation text intended for participants.
- [ ] Successful Compact history and the corresponding Thread Activity Time update are committed together; start, failure, and timeout do not update Thread Activity Time.
- [ ] Compact dividers retain their chronological position across Thread navigation and application restart.
- [ ] Multiple successful Compact cycles separated by new complete exchanges retain one ordered divider per confirmed success.
- [ ] After restart, Compact remains unavailable until a complete exchange exists after the latest persisted Compact for the current Runtime.
- [ ] Workspace Persistence round-trips valid Compact records and rejects malformed, unknown, oversized, or cross-Thread records without discarding valid conversation history.
- [ ] In-flight `Compacting` state is not persisted, and restart never synthesizes a Compact result.
- [ ] Desktop domain documentation defines Thread Action, expands Thread Activity Time to include successful persistent Thread Actions, and adds `Compacting` as a transient Thread Status outside Run lifecycle.
- [ ] Renderer, Chat Session Manager, and Workspace Persistence regression suites cover the complete approved behavior through the three agreed public seams without relying on private helper structure.
- [ ] Repository lint, typecheck, targeted Runtime tests, and affected Renderer tests pass.
