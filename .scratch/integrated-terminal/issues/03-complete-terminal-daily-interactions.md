# 03 — Complete terminal daily interactions

**What to build:** Make Project Terminal Tabs suitable for daily development by adding stable layout controls, standard macOS clipboard and keyboard behavior, scrollback search, safe web links, terminal context actions, and verification of interactive terminal programs and international input.

**Blocked by:** 02 — Maintain Project Terminal Tabs.

**Status:** ready-for-agent

- [ ] The panel remains below the main Project content and never covers the Workspace rail or secondary navigation pane.
- [ ] Dragging the panel's top edge resizes it within responsive minimum and maximum bounds and resizes the active PTY to the fitted columns and rows.
- [ ] Panel height is remembered across application restarts, while panel visibility still starts closed.
- [ ] `Cmd+J` toggles the panel globally; `Cmd+T`, `Cmd+W`, and `Cmd+F` are terminal commands only while terminal focus is active.
- [ ] `Cmd+C` copies selected text, `Ctrl+C` remains PTY input, and `Cmd+V` pastes while preserving bracketed-paste behavior when requested by the shell.
- [ ] A right-click menu offers Copy, Paste, Select All, Clear, and Terminate Current Terminal; Copy is disabled without a selection and right-click never pastes immediately.
- [ ] `Cmd+F` opens terminal-buffer search with next, previous, and close actions that never send search text to the PTY.
- [ ] `Cmd+click` on a supported web URL opens it through the system external-browser boundary, while ordinary click and drag remain available to terminal programs and selection.
- [ ] Unsafe or unsupported URL schemes are rejected, and generic local file paths are not turned into links.
- [ ] ANSI colors, True Color, alternate-screen applications, mouse reporting, bracketed paste, and PTY resize behave correctly with the maintained xterm capabilities.
- [ ] Unicode, emoji, Chinese input methods, wide characters, and text selection render without incoherent overlap or cursor drift in the supported smoke scenarios.
- [ ] Accessible labels identify the terminal toggle, Tab actions, search controls, resize affordance, and context-menu actions without relying only on icons.
- [ ] Renderer integration tests cover layout persistence, focus-scoped shortcuts, clipboard actions, context-menu states, search, URL activation, and dynamic terminal titles.
- [ ] A real macOS Electron smoke pass covers `vim`, `top`, `ssh` or an equivalent interactive prompt, mouse input, resizing, Chinese IME, copy and paste, URL opening, hidden background output, and multiple Terminal Tabs.
- [ ] The packaged application repeats the critical daily-interaction smoke checks after native dependency rebuilding and signing steps.

