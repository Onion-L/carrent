# 01 — Show Kimi Session Status end to end

**What to build:** Let a user with an existing Kimi Runtime Session choose Status from the Composer slash menu and inspect the complete Session ID plus current Context capacity in a Carrent-owned panel, without creating a Run or adding Runtime output to the conversation.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Carrent exposes a normalized read-only Session Status result containing the mapped Runtime Session ID, Context used tokens, Context total tokens, Runtime-reported used percentage, and Carrent-supported advertised commands.
- [ ] The Kimi integration initializes ACP, resumes the existing mapped Runtime Session, observes an exact advertised `status` capability, and sends one `session/prompt` containing only `/status`.
- [ ] Carrent never creates a Runtime Session solely to execute or discover Status.
- [ ] The mapped Runtime Session ID is included from Carrent-owned continuity state rather than parsed from display text.
- [ ] The observed Kimi Code 0.29.1 Context shape is normalized while model, Thinking, permission, Plan Mode, and unknown lines are ignored by the panel contract.
- [ ] Runtime-produced Status text is suppressed from user messages, Agent messages, Thinking, Tool Activity, Run Checklists, and Run Changes.
- [ ] An eligible Kimi Thread shows Status in the existing slash menu after Compact and before Skills and executes it immediately when selected.
- [ ] Successful execution opens a non-modal Carrent panel above the Composer with the English labels `Status`, `Session`, `Context`, and `Close`.
- [ ] The panel renders the complete text-selectable Session ID without adding a dedicated copy control to the panel; Thread context menus may offer a Session ID copy action.
- [ ] Context renders with copy equivalent to `Remaining 96.6% (35,193 used / 1M total)`, using grouped exact used tokens, compact total capacity, and at most one decimal place for remaining percentage.
- [ ] Status creates no Run, Message Timeline entry, queued message, Agent Activity, success Toast, or persisted status record.
- [ ] The existing Context usage indicator retains its current rendering and hover behavior and gains no click-to-open interaction.
- [ ] Mounted Composer tests cover the happy-path menu interaction, panel content, Context formatting, selectable Session text, non-modal presentation, and unchanged Context indicator.
- [ ] Kimi ACP and Chat Session Manager tests prove exact capability discovery, Session ownership, the bare command, Context parsing, suppressed Runtime output, and absence of Session creation.
