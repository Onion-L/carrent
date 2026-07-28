# 01 — Execute Kimi Compact end to end

**What to build:** Let a user with an eligible Kimi Thread choose Compact from the existing `/` menu, run Kimi's native context compaction against that Thread's existing Runtime Session, and receive an immediate `Context compacted` timeline boundary without creating a Run or conversation message.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Carrent exposes a Runtime-neutral Thread Action capability and execution contract whose first supported action is Compact.
- [ ] The Kimi integration initializes ACP, resumes the mapped Runtime Session, observes an exact advertised `compact` capability, and sends one `session/prompt` containing only `/compact`.
- [ ] Carrent never creates a new Runtime Session solely to execute Compact.
- [ ] An eligible Kimi Thread shows Compact in the existing slash menu and executes it immediately when selected.
- [ ] Starting Compact closes the slash menu, keeps the Composer available for editing, and disables sending for the affected Thread.
- [ ] Runtime output from the Compact command does not become a user message, Agent message, Thinking item, Tool Activity item, Run Checklist, or file-change record.
- [ ] A normal ACP response produces one Carrent-owned `Context compacted` divider in the live Message Timeline and no success Toast.
- [ ] Compact does not create a Run, emit Run lifecycle state, enter the queued-message flow, or alter Plan Mode, Runtime permission mode, model selection, drafts, or attachments.
- [ ] Renderer integration tests drive the public slash-menu interaction through the preload bridge and assert the visible compacting and success behavior.
- [ ] Chat Session Manager tests use a fake ACP transport to prove correct Session ownership, capability discovery, the exact bare command, suppressed Runtime output, and absence of Run events.
