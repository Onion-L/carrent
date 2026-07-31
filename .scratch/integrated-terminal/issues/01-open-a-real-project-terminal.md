# 01 — Open a real Project terminal

**What to build:** Let a user open one real macOS shell from any route with an available Project Working Directory. The terminal is displayed inside the Main Window, starts only on demand, accepts interactive input, streams output, resizes with its panel, and also works from a packaged Carrent build.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A terminal icon appears in the Main Window title bar on Project, Thread Draft, and Thread routes with an available Project Working Directory.
- [ ] Views without a current Project do not show the terminal action, and an unavailable Project Working Directory cannot create a shell or silently substitute another directory.
- [ ] Clicking the icon or pressing `Cmd+J` opens a bottom-docked terminal in the main content area and focuses it.
- [ ] Carrent starts with the panel closed and does not create a PTY before the user opens it.
- [ ] The terminal uses the official xterm.js renderer and the official `node-pty` package rather than a simulated command runner.
- [ ] The Electron Main Process owns the PTY, while the Renderer communicates through a narrow typed preload bridge for creation, input, output, resize, and exit.
- [ ] The shell uses a valid absolute `$SHELL` or falls back to `/bin/zsh`, starts as an interactive login shell, inherits Carrent's environment, and starts in the Project Working Directory.
- [ ] The shell runs with Carrent's current macOS user permissions without adding a command allowlist, approval flow, or claim of bypassing macOS privacy controls.
- [ ] Typed input, streamed output, terminal resize, ordinary shell exit, and explicit termination work end to end.
- [ ] The terminal keeps at most 10,000 lines of in-memory scrollback and does not persist screen contents in the App State Snapshot.
- [ ] Hiding the terminal keeps its PTY alive; explicit Carrent Quit ends it without adding a terminal-specific confirmation.
- [ ] Terminal bridge payloads reject invalid dimensions, oversized input, stale identifiers, and calls from an unexpected Renderer owner.
- [ ] Renderer application tests cover route visibility, opening, focus, hiding, unavailable directories, and visible terminal output through a preload-shaped fake.
- [ ] Terminal manager and IPC tests cover public lifecycle behavior through a fake PTY without asserting private collection structure or native call order.
- [ ] A real macOS smoke check verifies shell startup, input, output, resize, and exit in the Electron development build.
- [ ] The packaged macOS application and DMG build successfully, launch, and open a working real terminal with the native PTY dependency included correctly.

