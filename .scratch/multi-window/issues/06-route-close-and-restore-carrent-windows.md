# 06 — Route, close, and restore Carrent Windows

**What to build:** Complete Carrent Window lifecycle behavior across repeated launches, deep links, platform-specific final-window closure, explicit Quit, Dock activation, and restart restoration of the windows that were still open.

**Blocked by:** 05 — Open and manage peer Carrent Windows.

**Status:** ready-for-agent

- [ ] A repeated ordinary application launch focuses the most recently active existing Carrent Window without creating a window or changing any route.
- [ ] A valid Thread deep link focuses the most recently active window already showing that Thread, otherwise navigates the most recently active window, and never creates a window.
- [ ] Invalid deep-link routes use the established nearest-valid-parent fallback in the selected window.
- [ ] Closing the final window on macOS leaves Carrent, its Runs, and its Terminal Tabs active with no hidden Carrent Window retained.
- [ ] Dock activation or repeated launch with no macOS window creates one window using normal recent-position recovery.
- [ ] Closing the final window on Windows or Linux requests application Quit and uses the existing live-Run confirmation flow.
- [ ] Explicit Quit on every platform closes every window and ends Runs and Terminal Tabs only after any required live-Run confirmation succeeds.
- [ ] A normal restart restores every Carrent Window still open at Quit with its route, normal bounds, and maximized state.
- [ ] A window explicitly closed before Quit is not restored.
- [ ] Restored invalid routes fall back normally, while browsing history, transient pane state, terminal panel visibility, PTYs, and terminal output are not restored.
- [ ] Main-process tests cover recent-window targeting, deep links, zero-window activation, platform close behavior, cancelled and confirmed Quit, session persistence, restoration, and invalid-route fallback.

