# 07 — Share Project Terminal Tabs across windows

**What to build:** Make Terminal Tabs truly Project-owned across all Carrent Windows, including shared output and active selection, control from any window, survival of individual window closure, and focus-based PTY resize authority.

**Blocked by:** 05 — Open and manage peer Carrent Windows.

**Status:** ready-for-agent

- [ ] Every Carrent Window showing a Project receives the same Terminal Tabs, active Tab, title, status, retained screen output, and subsequent PTY output.
- [ ] Any Carrent Window showing the Project can create, activate, write to, and close its shared Terminal Tabs.
- [ ] Creating or closing a Terminal Tab and changing the active Tab updates every interested Renderer without duplicate PTYs or divergent active selections.
- [ ] Closing or reloading a Carrent Window detaches that Renderer without terminating any Terminal Tab.
- [ ] Project relocation, final Association removal, explicit Terminal Tab closure, and application Quit retain their established PTY termination rules.
- [ ] A focused terminal viewport reports its dimensions and becomes the sole resize authority for the shared PTY.
- [ ] Moving terminal focus to another Carrent Window transfers resize authority and applies that viewport's dimensions.
- [ ] An unfocused Renderer continues receiving terminal output but cannot resize the PTY; with no focused viewport, the PTY retains its last dimensions.
- [ ] Terminal state remains process-lifetime only and is not included in restart restoration.
- [ ] Terminal manager and IPC tests cover Project ownership, multiple Renderer subscribers, output replay and fan-out, commands from either window, focus races, stale resize requests, Renderer closure, Project cleanup, and Quit.
- [ ] Renderer tests cover two terminal viewports observing one Project, shared Tab controls, output continuity, and resize-authority transfer.

