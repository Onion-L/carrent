# 05 — Question lifecycle and concurrency protection

**What to build:** Make pending structured questions reliable under real Run lifecycle events. Carrent must allow only one pending question per Run, keep it waiting without a Carrent timeout, and safely reject or interrupt every stale, duplicate, disconnected, or cancelled interaction.

**Blocked by:** 02 — Run-scoped MCP single question

**Status:** ready-for-agent

- [ ] A Run can own at most one pending question request, including across the native ACP and full MCP entry points.
- [ ] A second request receives a structured `question_already_pending` error and cannot replace the active panel.
- [ ] Carrent adds no business timeout while a live transport and Run are still waiting for the user.
- [ ] Run stop, failure, cancellation, Runtime Session failure, MCP disconnect, Thread deletion, and application shutdown interrupt the pending request and release its HTTP connection.
- [ ] A response with a stale request identifier, wrong Run identifier, invalid selection, or terminated Run is rejected without resolving another request.
- [ ] Repeated responses are idempotently rejected after the first resolution.
- [ ] Temporary MCP servers close on completion, failure, stop, startup failure, and shutdown without leaking ports or pending promises.
- [ ] Diagnostic events distinguish the MCP and native ACP paths without recording free-text answers.
- [ ] Run-boundary and IPC tests cover every terminal path, concurrent calls, late responses, duplicate responses, and cleanup.

