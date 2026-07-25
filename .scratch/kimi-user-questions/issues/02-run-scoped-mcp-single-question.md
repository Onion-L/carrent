# 02 — Run-scoped MCP single question

**What to build:** Give each supported Kimi Run a private `carrent_session` MCP server that exposes a full-fidelity Carrent question tool. For this tracer bullet, the advertised tool contract permits one single-select question with predefined options and automatic `Other` free text, and the existing question panel returns a Kimi-compatible answer to the waiting MCP call.

**Blocked by:** 01 — Native ACP single-choice question

**Status:** ready-for-agent

- [ ] A supported Kimi Run receives an authenticated loopback `carrent_session` HTTP MCP descriptor in addition to any enabled global Carrent Bridge descriptor.
- [ ] The temporary server exposes only `ask_user_question`, with a description directing Kimi to prefer it over the built-in `AskUserQuestion` in Carrent.
- [ ] The initial advertised schema accepts exactly one single-select question and rejects unsupported shapes rather than silently degrading them.
- [ ] Calling the tool emits the same transport-neutral pending-question contract used by the native ACP path.
- [ ] The MCP HTTP request remains pending until the user submits or skips; Carrent adds `Other` without requiring the Coding Agent to supply it.
- [ ] A predefined selection returns Kimi's `answers` object keyed by question text.
- [ ] A single-select `Other` answer returns the user's non-empty custom text and excludes predefined selections.
- [ ] Skip returns an empty `answers` object with a dismissal note compatible with Kimi behavior.
- [ ] The temporary server closes on normal Run completion, and the public Run test proves the HTTP round trip without a real Kimi process.

