# 01 - Establish Kimi Timeline for Thinking and message segments

**What to build:** Make a Kimi Run appear as an ordered timeline of visible Thinking phases and agent message segments. A user can watch a sequence such as Thinking, message, Thinking, message without losing phase boundaries or seeing streamed chunks flattened into one global response.

**Blocked by:** None - can start immediately

**Status:** ready-for-agent

- [ ] Consecutive `agent_thought_chunk` events are merged into one Thinking item with a stable id and first-seen order.
- [ ] A tool event, plan event, or agent message event completes the current Thinking item; later thinking creates a new item.
- [ ] Thinking items expose running and completed states, remain in the timeline, and are collapsed by default while remaining expandable.
- [ ] Consecutive `agent_message_chunk` events are merged into one message segment, while segments separated by another timeline item retain their original order.
- [ ] The Kimi-specific normalized update travels through the existing Chat run event channel and the shared message state can upsert an item without changing its order.
- [ ] The renderer shows Thinking and message segments in their normalized order during a live Kimi Run; it does not discard raw Kimi Thinking items or infer ordering from the last activity index.
- [ ] Existing Kimi Runs without tools still start, stream, and reach their existing terminal result.
- [ ] Fake ACP transport tests cover chunk merging, phase boundaries, stable ordering, and an unknown update that does not affect a known timeline item.
- [ ] Renderer and message-state tests cover default collapse, expansion, ordered upsert, and replaying the same item update without duplication.
