# 02 — Maintain Project Terminal Tabs

**What to build:** Expand the single terminal into a Project-owned group of Terminal Tabs that remains stable while the user moves between Threads and Workspaces. Each Project keeps independent shells and output for the Carrent process lifetime, and Project lifecycle changes clean up only the PTYs they truly invalidate.

**Blocked by:** 01 — Open a real Project terminal.

**Status:** ready-for-agent

- [ ] Opening `+` or pressing `Cmd+T` while the terminal is focused creates another Terminal Tab for the current Project.
- [ ] Every new Terminal Tab starts in the Project Working Directory instead of inheriting another Tab's current directory.
- [ ] The first Tab uses the Project display name and later Tabs receive distinct numbered initial labels.
- [ ] A bounded and sanitized standard OSC title update changes the matching Tab label without affecting another Terminal Tab.
- [ ] Switching Threads or moving between a Thread Draft and Threads in one Project preserves Terminal Tabs, active selection, PTYs, and output.
- [ ] Switching Projects shows the destination Project's Terminal Tabs and prevents output or input from appearing under the wrong Project.
- [ ] If the panel is open when the user reaches a Project with no Terminal Tabs, Carrent automatically creates that Project's first Tab.
- [ ] Returning to a Project restores its active Terminal Tab and retained in-memory output.
- [ ] The same Project shares Terminal Tabs across all of its Workspace-Project Associations.
- [ ] Removing one Association preserves Terminal Tabs when another Association still references the Project.
- [ ] Explicitly relocating the Project Working Directory ends all Terminal Tabs for that Project before a new Tab can start at the replacement path.
- [ ] Removing the final Association and Project record ends all Terminal Tabs for that Project.
- [ ] Closing a Terminal Tab ends its shell and child processes; closing the final Tab hides the panel.
- [ ] Reopening after the final Tab closes creates a fresh shell.
- [ ] Hiding the Main Window on macOS keeps all Terminal Tabs running, while explicit Quit ends every remaining PTY.
- [ ] Terminal Tabs, active Tab selection, output, and PTYs are not restored after an application restart.
- [ ] Renderer integration tests cover multiple Tabs, active selection, Thread navigation, Project switching, shared Associations, final-Tab behavior, and isolated output.
- [ ] Terminal manager tests cover Project grouping, relocation, partial and final Association removal, duplicate exits, inactive output, Main Window hide, and application Quit.

