# 04 — Provide zsh history ghost text

**What to build:** Add an optional zsh enhancement that shows a locally generated history prediction as muted text after the current cursor. It must preserve the user's normal zsh startup and native `Tab` completion, expose no terminal data to a model or network service, and fall back to an ordinary usable shell if integration fails.

**Blocked by:** 01 — Open a real Project terminal.

**Status:** ready-for-agent

- [ ] A global Enhanced Terminal Completion setting exists, defaults on, and affects only Terminal Tabs created after the setting changes.
- [ ] Enhanced completion is applied only when the configured shell is zsh; bash, fish, and other shells still start normally with native completion.
- [ ] Carrent injects temporary zsh Shell Integration without modifying user dotfiles and still loads the user's expected interactive login configuration.
- [ ] If Shell Integration cannot initialize or is disabled, the Terminal Tab remains a fully usable ordinary shell.
- [ ] Shell Integration reports bounded prompt state, editable command text, cursor position, current directory, and required shell symbols through a trusted per-terminal protocol.
- [ ] Ordinary program output cannot impersonate trusted Shell Integration control messages or mutate completion state.
- [ ] History prediction reads common valid forms from the user's `~/.zsh_history` and includes commands executed during the current Carrent process.
- [ ] Malformed or unreadable history entries are ignored without delaying or preventing terminal startup.
- [ ] Predictions match the current command prefix and display only the remaining suffix as muted inline text.
- [ ] `Right Arrow` and `End` accept the full prediction, `Option+Right Arrow` accepts the next word, and `Escape` dismisses the prediction.
- [ ] `Tab` remains entirely owned by zsh native completion even while a ghost prediction is visible.
- [ ] Moving the cursor, editing earlier text, running a command, entering an alternate-screen program, or leaving a supported prompt state updates or removes stale ghost text.
- [ ] Command history and editable input are processed locally, never sent to a model or network service, and never populated from terminal command output.
- [ ] Controlled zsh process tests cover startup, trusted state reporting, user configuration preservation, whole and partial acceptance, dismissal, native `Tab`, and fallback.
- [ ] Renderer integration tests cover visible ghost text, editing and cursor changes, privacy boundaries, the global setting, non-zsh behavior, and integration failure.

