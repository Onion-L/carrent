# 03 - Make Kimi final answers and Run terminal authoritative

**What to build:** Make Kimi's prompt response determine the final answer and Run outcome. A user can distinguish intermediate messages from the final response, see accurate completed/failed/stopped states, and trust that cancellation or a late ACP event cannot rewrite a finished Run.

**Blocked by:** 01 - Establish Kimi Timeline for Thinking and message segments; 02 - Add the unified Kimi Tool Timeline

**Status:** ready-for-agent

- [ ] After the `session/prompt` response, the last valid agent message segment is marked as final and terminal `finalText` is assembled from final segments in timeline order.
- [ ] Final-answer classification does not depend on `lastActivityIndex`; intermediate message segments stay in their original timeline position.
- [ ] Permission, notification, and other control activity cannot become a final message segment.
- [ ] `end_turn`, `max_tokens`, and `max_turn_requests` produce a completed Run; `cancelled` produces a stopped Run; `refusal` produces a failed Run.
- [ ] An unknown stop reason fails the Run with the reason preserved, without being mistaken for a normal completion.
- [ ] Stopping a live Run marks running Thinking and tool items as cancelled while preserving completed, failed, and already cancelled items.
- [ ] A completed, failed, or cancelled tool cannot be changed back to running by a later ordinary update.
- [ ] Once terminal is reached, late ACP updates and transport-close callbacks cannot change timeline items or publish another terminal event.
- [ ] The renderer places only final message segments in the final answer area and keeps intermediate messages, Thinking, and tools in timeline order.
- [ ] No summary model request is sent as part of finalization.
- [ ] Fake ACP transport tests cover every stop reason, cancellation, late updates, duplicate terminal attempts, and final text assembly.
