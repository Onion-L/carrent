# 02 - Add the unified Kimi Tool Timeline

**What to build:** Show every Kimi tool call, including shell and generic tools, as one inspectable timeline item. A user can see the tool title and kind, follow its input and output, and understand whether it is pending, running, completed, or failed without duplicate cards or overwritten parallel calls.

**Blocked by:** 01 - Establish Kimi Timeline for Thinking and message segments

**Status:** ready-for-agent

- [ ] The first `tool_call` for a tool creates one tool timeline item at its first-seen order.
- [ ] `tool_call_update` with the same `toolCallId` updates that item in place and never moves it to the end of the timeline.
- [ ] An update that arrives before its start creates a temporary item that is completed with later title, kind, input, output, and status data.
- [ ] Different tool ids, including concurrent calls, remain independent and cannot overwrite one another.
- [ ] Missing tool ids receive unique Run-scoped ids derived from the Run and event sequence; no fixed fallback id is reused.
- [ ] Shell and generic tools use the same timeline contract and renderer path, while shell command details remain available when present.
- [ ] Tool input, output, error, title, kind, and status are retained, with output and failure details visible in the tool item.
- [ ] Normal ACP tool states map to pending, running, completed, or failed without treating a generic tool as a Thinking item.
- [ ] Tool updates end the current Thinking phase but preserve the already assigned timeline order.
- [ ] Fake ACP transport and renderer tests cover repeated updates, update-before-start, parallel ids, missing ids, generic tools, shell tools, output, and failure display.
