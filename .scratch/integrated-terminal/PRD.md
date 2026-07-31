# Integrated Terminal PRD

Status: ready-for-agent

## Problem Statement

Carrent users work on local Projects but must leave Carrent or manage a separate terminal window whenever they need to run a command directly. That breaks the connection between the current Project, its Project Working Directory, and the Thread the user is viewing. Carrent also cannot currently preserve a user-started development server or interactive command while the user moves between Threads in the same Project.

The user wants a real terminal inside the Main Window, opened from the current Project and backed by the same shell and local permissions they would have in a standalone terminal. A command runner or simulated console is insufficient: interactive programs, terminal control sequences, shell configuration, native completion, multiple Terminal Tabs, and long-running processes must behave like a normal macOS terminal.

The user also wants two complementary completion experiences. Existing shell-native completion must continue to work, while Carrent should add zsh-specific history prediction and an IDE-style candidate surface without sending command history to a model or external service.

## Solution

Carrent adds a resizable Integrated Terminal panel docked to the bottom of the current Project view. A terminal icon in the Main Window title bar and `Cmd+J` show or hide the panel. Opening the panel creates a real pseudo-terminal in the Project Working Directory and starts the user's interactive login shell. The Renderer uses xterm.js for terminal presentation, while the Electron Main Process owns PTY processes through the official `node-pty` package.

Each Project owns an in-memory group of Terminal Tabs. The group is shared when the same Project appears through different Workspace-Project Associations. Terminal Tabs and their output survive panel hiding, Project navigation, and Thread navigation for the lifetime of the Carrent process. They are never persisted across an application restart.

The Integrated Terminal supports standard terminal behavior, multiple Terminal Tabs, resizing, search, selection, clipboard operations, clickable web links, interactive programs, Unicode input, and shell-provided completion. For zsh, an optional Carrent Shell Integration adds local history-based ghost text and a candidate surface for executables, shell symbols, paths, and an initial set of common development CLIs. A later delivery expands Fig-derived rules and CLI coverage without changing the first release's acceptance criteria.

## User Stories

1. As a Carrent user, I want to open a terminal from the current Project, so that I can run commands without leaving Carrent.
2. As a Carrent user, I want the terminal to start in the Project Working Directory, so that commands apply to the Project I am viewing.
3. As a Carrent user, I want the terminal button in the upper-right title bar, so that it is available without consuming chat space.
4. As a Carrent user, I want the terminal button shown on Project, Thread Draft, and Thread views, so that every Project-scoped workflow can reach the terminal.
5. As a Carrent user, I want the terminal button absent from views without a current Project, so that Carrent never guesses a working directory.
6. As a Carrent user, I want an unavailable Project Working Directory to prevent terminal creation and explain why, so that a shell is not silently opened somewhere else.
7. As a keyboard user, I want `Cmd+J` to show or hide the terminal, so that I can reach it without a pointer.
8. As a Carrent user, I want the terminal docked below the main Project content, so that Workspace navigation remains visible.
9. As a Carrent user, I want to drag the terminal's top edge, so that I can allocate space between the Thread and terminal.
10. As a Carrent user, I want Carrent to remember my preferred terminal height, so that I do not resize it repeatedly.
11. As a Carrent user, I want Carrent to start with the terminal closed, so that launching the app does not create a shell before I request one.
12. As a Carrent user, I want hiding the panel to preserve its terminal processes, so that long-running commands continue in the background.
13. As a Carrent user, I want switching Threads in one Project to preserve the same Terminal Tabs and output, so that the terminal belongs to the Project rather than a Thread.
14. As a Carrent user, I want switching Projects to show the destination Project's Terminal Tabs, so that commands and output cannot be confused across Projects.
15. As a Carrent user, I want a first Terminal Tab created automatically when an open panel reaches a new Project, so that it is immediately ready for input.
16. As a Carrent user, I want returning to a Project to restore its active Terminal Tab and scrollback, so that navigation does not interrupt my work.
17. As a Carrent user, I want the same Project to share its Terminal Tabs across Workspace-Project Associations, so that Workspace presentation does not duplicate terminal processes.
18. As a Carrent user, I want to create multiple Terminal Tabs for one Project, so that I can run a server and issue commands independently.
19. As a keyboard user, I want `Cmd+T` to create a Terminal Tab while the terminal is focused, so that tab creation is fast.
20. As a keyboard user, I want `Cmd+W` to close the active Terminal Tab while the terminal is focused, so that terminal tab management matches macOS conventions.
21. As a Carrent user, I want closing a Terminal Tab to end its shell and child processes, so that it releases resources predictably.
22. As a Carrent user, I want closing the final Terminal Tab to hide the panel, so that Carrent does not leave an empty terminal area.
23. As a Carrent user, I want reopening after the final Tab closes to create a fresh shell, so that the panel is usable immediately.
24. As a Carrent user, I want every new Terminal Tab to start at the Project Working Directory, so that a prior Tab's `cd` does not affect it.
25. As a Carrent user, I want to `cd` outside the Project after the shell starts, so that the terminal retains normal filesystem capabilities.
26. As a Carrent user, I want Carrent to start my configured shell, so that my normal command-line environment is available.
27. As a Carrent user, I want the shell to be interactive and login-capable, so that expected startup files, PATH changes, aliases, functions, and version managers load.
28. As a Carrent user, I want commands to inherit Carrent's process environment, so that environment variables available to the app remain available in the terminal.
29. As a Carrent user, I want the terminal to have my current macOS user permissions, so that it can perform the same local work as my standalone terminal.
30. As a Carrent user, I want macOS privacy controls to remain authoritative, so that Carrent never claims to bypass Full Disk Access or other system authorization.
31. As a Carrent user, I want full ANSI and True Color rendering, so that command output and prompts render correctly.
32. As a Carrent user, I want interactive terminal programs such as `vim`, `top`, and `ssh` to work, so that the panel is not limited to one-shot commands.
33. As a Carrent user, I want terminal mouse reporting to work for programs that request it, so that interactive applications remain usable.
34. As a Carrent user, I want terminal dimensions sent to the PTY when the panel or Main Window changes size, so that interactive programs lay out correctly.
35. As a Carrent user, I want Unicode, emoji, and Chinese input methods to work, so that terminal input and output are not restricted to ASCII.
36. As a Carrent user, I want recently printed output retained while the panel is hidden, so that background logs are available when I return.
37. As a Carrent user, I want scrollback bounded to 10,000 lines per Terminal Tab, so that long-running output cannot consume memory without limit.
38. As a Carrent user, I want terminal scrollback kept only in memory, so that Carrent does not create a separate persistent command-output log.
39. As a Carrent user, I want Terminal Tabs and screen contents discarded when Carrent quits, so that a new launch starts cleanly.
40. As a Carrent user, I want my shell's own history mechanism to continue working, so that normal zsh history survives independently of terminal screen persistence.
41. As a Carrent user, I want Carrent to quit without a terminal-specific confirmation, so that an idle shell does not create repetitive warnings.
42. As a Carrent user, I want explicit Carrent Quit to end all PTYs, so that no terminal process is orphaned after the app exits.
43. As a Carrent user, I want hiding the Main Window on macOS to leave Terminal Tabs running, so that normal window close behavior does not act like application Quit.
44. As a Carrent user, I want Terminal Tabs terminated when their Project Working Directory is explicitly relocated, so that no Tab remains attached to the old path.
45. As a Carrent user, I want a Project's Terminal Tabs retained when only one of several Workspace-Project Associations is removed, so that another reference to the same Project keeps working.
46. As a Carrent user, I want Terminal Tabs terminated when the final Association and Project record are removed, so that deleted Carrent state does not retain background shells.
47. As a Carrent user, I want a Terminal Tab to display the Project name by default, so that I can identify its origin.
48. As a Carrent user, I want later Terminal Tabs numbered, so that multiple shells have distinct initial labels.
49. As a Carrent user, I want programs that emit a standard terminal title to update the Tab label, so that SSH sessions and long-running tools can identify themselves.
50. As a Carrent user, I want to select and copy terminal text, so that I can reuse command output elsewhere.
51. As a Carrent user, I want `Cmd+C` to copy selected terminal text and `Ctrl+C` to remain shell interrupt, so that macOS and terminal conventions both work.
52. As a Carrent user, I want `Cmd+V` to paste into the active terminal, so that clipboard input is convenient.
53. As a Carrent user, I want a right-click menu with Copy, Paste, Select All, Clear, and Terminate actions, so that common commands are discoverable.
54. As a Carrent user, I want Copy disabled when there is no selection, so that unavailable actions are clear.
55. As a Carrent user, I want right-click to open a menu rather than paste immediately, so that an accidental click cannot execute clipboard contents.
56. As a Carrent user, I want `Cmd+F` to search the active terminal's scrollback, so that I can locate earlier output.
57. As a Carrent user, I want search to move between matches and close without modifying shell input, so that finding output is non-destructive.
58. As a Carrent user, I want `Cmd+click` on a web URL to open the system browser, so that terminal links are useful without stealing ordinary mouse clicks.
59. As a Carrent user, I want ordinary clicking and dragging reserved for terminal interaction and selection, so that link detection does not interfere with terminal programs.
60. As a Carrent user, I want shell-native `Tab` completion to remain available for every shell, so that existing completion plugins and configuration keep working.
61. As a zsh user, I want Carrent to predict a command from my history as gray text after the cursor, so that repeated commands require less typing.
62. As a zsh user, I want the prediction to match the current command prefix, so that unrelated history is not shown.
63. As a zsh user, I want `Right Arrow` or `End` to accept the whole prediction, so that I can complete it quickly.
64. As a zsh user, I want `Option+Right Arrow` to accept the next predicted word, so that I can keep only part of a suggestion.
65. As a zsh user, I want `Escape` to hide a prediction, so that I can continue typing without accepting it.
66. As a zsh user, I want native `Tab` to remain owned by zsh even when Carrent has a prediction, so that enhanced completion does not replace shell completion.
67. As a zsh user, I want history predictions to include my existing `~/.zsh_history`, so that suggestions are useful on the first Carrent terminal.
68. As a zsh user, I want commands executed during the current Carrent process included in predictions, so that recent work is suggested immediately.
69. As a privacy-conscious user, I want command history processed locally without model calls or network requests, so that terminal commands remain on my machine.
70. As a privacy-conscious user, I want Carrent's completion engine to ignore command output, so that logs and secrets printed by programs do not become completion data.
71. As a zsh user, I want an IDE-style candidate surface for executables, shell symbols, paths, and supported CLI arguments, so that I can discover valid commands while typing.
72. As a zsh user, I want PATH executables, builtins, aliases, and functions included in candidates, so that the surface reflects my shell environment.
73. As a zsh user, I want files and directories relative to the shell's current directory included in candidates, so that path entry is faster.
74. As a developer, I want initial argument-aware candidates for Git, GitHub CLI, Bun, npm, npx, pnpm, and Yarn, so that common Project commands include descriptions and subcommands.
75. As a zsh user, I want candidate UI to avoid stealing native history and `Tab` keys, so that normal shell editing remains predictable.
76. As a Carrent user, I want enhanced completion enabled by default, so that the feature works without setup.
77. As a Carrent user with a complex zsh configuration, I want a global setting to disable enhanced completion, so that I can fall back to an untouched login shell.
78. As a Carrent user, I want changing the enhanced-completion setting to affect new Terminal Tabs only, so that an active shell is not rewritten underneath me.
79. As a Carrent user, I want enhanced completion failure to leave the real terminal usable, so that optional integration cannot block shell access.
80. As a bash or fish user, I want my configured shell and its native completion to work even though Carrent's first enhanced completion supports only zsh, so that shell choice is respected.
81. As a Carrent maintainer, I want terminal process ownership in the Main Process, so that Renderer navigation cannot accidentally kill PTYs.
82. As a Carrent maintainer, I want a typed preload bridge to expose terminal actions and events, so that the Renderer never receives Node or PTY access directly.
83. As a Carrent maintainer, I want terminal actions scoped by Project identity and Terminal Tab identity, so that events cannot be applied to the wrong Project.
84. As a Carrent maintainer, I want Renderer behavior tested through the existing application integration boundary, so that tests reflect what users see.
85. As a Carrent maintainer, I want PTY lifecycle behavior tested through a fake PTY adapter, so that process behavior is deterministic without asserting internal collection structure.
86. As a Carrent maintainer, I want the official xterm.js and `node-pty` packages reused, so that Carrent does not maintain a terminal emulator or PTY implementation.
87. As a Carrent maintainer, I want Electron native-module and DMG packaging verified on macOS, so that a terminal that works in development also works in distribution.
88. As a future Carrent user, I want more Fig-derived completion rules and CLI specifications added incrementally, so that enhanced completion coverage grows without delaying the first terminal release.

## Implementation Decisions

- The first release supports macOS only. Windows ConPTY behavior and Linux packaging are separate future work.
- Carrent reuses the official xterm.js terminal renderer and its maintained fit, search, clipboard, and web-link capabilities. Carrent does not implement ANSI parsing or terminal emulation itself.
- Carrent uses the official `node-pty` package for real PTYs. Development startup and Electron packaging must rebuild or select the native artifact for the Electron runtime; third-party prebuilt forks are not used.
- A Terminal Session Manager in the Electron Main Process owns PTY creation, input, output, resize, title, exit, and cleanup. This first release does not introduce an Electron utility process.
- The term Terminal Tab refers to one xterm presentation paired with one PTY-backed shell process. It is distinct from a Runtime Session and must not be described as a Runtime Session in product or domain language.
- The preload bridge exposes narrow typed operations for listing, creating, writing to, resizing, activating, and closing Terminal Tabs, plus receiving output, title, and exit events. The Renderer does not import `node-pty` or gain direct Node access.
- Terminal identifiers are opaque and generated by Carrent. Every Terminal Tab is associated with exactly one Project identity and the Main Window's Renderer owner.
- The terminal icon is contributed through the established Main Window title-bar action surface. It is available only when the current route resolves to a Project with an available Project Working Directory.
- The Integrated Terminal is part of the Main Window shell rather than an individual Thread component. This lets one Project's Terminal Tabs survive movement between its Thread Draft and Threads.
- The panel occupies the bottom of the main content area and never covers the Workspace rail or secondary navigation pane. A horizontal drag handle changes its height within responsive minimum and maximum bounds.
- Panel height is the only terminal layout preference persisted across application restarts. Panel visibility starts closed on every launch, so no PTY starts before the user opens the terminal.
- During one Carrent process lifetime, panel visibility and height remain stable while the user navigates. If the panel remains open and the destination Project has no Terminal Tab, Carrent creates its first Tab automatically.
- Terminal Tabs are grouped by Project, not Workspace, Workspace-Project Association, Thread Draft, or Thread. The same Project therefore exposes the same in-memory terminal group from every Association.
- Hiding the panel or hiding the Main Window does not end a PTY. Closing a Terminal Tab does. Closing the final Tab also hides the panel.
- Explicit application Quit ends all terminal PTYs without adding terminal-specific confirmation. The existing live Run quit policy remains authoritative and unchanged.
- Project relocation ends all Terminal Tabs for that Project before subsequent terminal creation can use the new Project Working Directory.
- Removing one Workspace-Project Association preserves terminals when the Project remains associated elsewhere. Removing the final Association and Project record ends its Terminal Tabs.
- The default shell comes from `$SHELL` when it is a usable absolute executable path and otherwise falls back to `/bin/zsh`. It starts as an interactive login shell in the Project Working Directory and inherits a sanitized copy of the Carrent process environment.
- Carrent does not add a command allowlist, approval flow, or sandbox around terminal input. PTY processes run with the Carrent process's current macOS user permissions and remain subject to macOS privacy and filesystem controls.
- Every new Terminal Tab starts in the Project Working Directory, regardless of another Tab's current directory. Once started, the shell may change directory freely.
- A first Terminal Tab uses the Project display name. Additional initial labels append a stable number. Standard OSC title changes update the active label after bounded validation and sanitization.
- Each xterm instance uses a 10,000-line scrollback limit. Output remains in memory while hidden; terminal screen state and output are not written to the App State Snapshot or another persistent store.
- Terminal Tabs, their active selection, terminal output, and PTYs are not restored across Carrent restart. Shell-owned history files continue to behave normally.
- The terminal must support ANSI and True Color output, alternate screen applications, mouse reporting, bracketed paste, PTY resize, Unicode, and macOS input methods through xterm.js capabilities.
- The title-bar terminal button and `Cmd+J` both toggle panel visibility. `Cmd+T`, `Cmd+W`, and `Cmd+F` are terminal commands only while terminal focus is active; they retain existing Main Window behavior elsewhere.
- `Cmd+C` copies when the terminal has a selection. `Ctrl+C` remains PTY input. `Cmd+V` pastes through a bounded clipboard path that preserves bracketed-paste behavior when the shell requests it.
- The right-click menu contains Copy, Paste, Select All, Clear, and Terminate Current Terminal. Copy is disabled without a selection. Right-click never pastes immediately.
- The search surface operates on the active xterm buffer, supports next and previous matches, and does not send text to the PTY.
- Web URLs are recognized by the maintained xterm web-link capability. Only `Cmd+click` opens them through Electron's external-browser boundary. Generic local file-path linking is excluded from the first release.
- Shell-native completion is always preserved. Carrent never consumes `Tab` for its enhanced completion layer.
- Enhanced completion supports zsh only in the first release. Bash, fish, and other configured shells still receive the full PTY experience and their own native completion.
- Carrent injects a temporary zsh Shell Integration at process startup without modifying user dotfiles. It must source the user's normal zsh startup configuration and degrade to a usable shell if integration cannot initialize.
- A global Enhanced Terminal Completion setting defaults on. A setting change applies only to Terminal Tabs created afterward.
- The zsh integration exposes only the current editable command line, cursor position, current directory, prompt boundary, and relevant shell symbols needed by completion. Integration control messages use bounded, authenticated terminal control sequences so ordinary program output cannot impersonate trusted completion state.
- History prediction reads the user's existing `~/.zsh_history` and commands executed in Carrent during the current app process. Parsing handles common zsh extended-history records and malformed lines without preventing terminal startup.
- Completion processing is local, does not call a model, does not use the network, and does not index terminal command output.
- Ghost text renders as a muted suffix after the current cursor. `Right Arrow` and `End` accept the full suffix, `Option+Right Arrow` accepts one word, and `Escape` dismisses it. Native `Tab` remains unchanged.
- The candidate surface covers PATH executables, zsh builtins, aliases, functions, files, directories, and first-party specifications for Git, GitHub CLI, Bun, npm, npx, pnpm, and Yarn.
- Candidate presentation must not take over shell history or native completion by default. Its exact internal ranking may evolve, but acceptance is based on correct eligible candidates, keyboard accessibility, insertion at the shell cursor, and no interference after dismissal.
- Fig and VS Code are reference implementations and rule sources, not drop-in dependencies. Any reused MIT-licensed rule or source material must retain required license notices and be adapted behind Carrent's own completion boundary.
- Delivery is divided into three independently verifiable implementation issues under this PRD: core PTY and panel; Terminal Tab and panel capabilities; zsh enhanced completion.
- A separate follow-up issue must track expanding Fig-derived specifications, adding more CLI rules, and evaluating enhanced completion for bash and fish. That follow-up is not part of first-release acceptance and must not be lost when the three initial issues are completed.
- No existing ADR conflicts with the Integrated Terminal. The feature is independent of Runtime transport, the Agent Loop, and Agent Activity, so no new system-wide ADR is required for the accepted first-release design.

## Testing Decisions

- Good tests assert externally observable terminal behavior: bridge results and events, visible panel state, Terminal Tab lifecycle, Project scoping, command-line completion results, and cleanup effects. They do not assert private React state, collection layout, CSS class strings, `node-pty` call order, or implementation helper names.
- The primary Renderer test boundary is the existing full application integration harness with a preload-shaped `window.carrent` fake. Tests navigate real Workspace, Project, Thread Draft, and Thread routes and observe the Main Window title action and Integrated Terminal UI.
- Renderer integration tests cover terminal-button presence and absence, unavailable Project behavior, `Cmd+J`, panel resizing, height restoration, launch-closed behavior, automatic first Tab creation, multiple Tabs, active Tab changes, final-Tab hiding, and focus-scoped shortcuts.
- Renderer integration tests cover Thread navigation within a Project, Project switching, a Project shared across Associations, returning to retained output, and isolation between different Projects.
- Renderer integration tests cover selection-aware Copy, Paste, right-click menu availability, search state, `Cmd+click` web links, dynamic Tab titles, terminal exit display, and accessible labels and states.
- The backend test boundary is the Terminal Session Manager with an injected PTY adapter. A fake PTY exposes the same public lifecycle as `node-pty` and lets tests observe process-facing effects without loading a native module.
- Session Manager tests cover shell and working-directory selection, inherited environment, unique identifiers, input forwarding, resize validation, output and title event routing, ordinary exit, explicit termination, final Association removal, Project relocation, Renderer destruction, Main Window hide, and application Quit.
- Backend tests verify malformed Project identities, invalid dimensions, oversized input, stale Terminal Tab identifiers, duplicate exit events, and events for a different Renderer owner cannot corrupt or control another terminal.
- IPC registration tests use the existing fake `ipcMain` pattern to verify channel contracts dispatch to the Terminal Session Manager and return bounded serializable results.
- The preload contract is compile-time checked and covered by a narrow bridge test where behavior is not already visible through the Renderer integration seam.
- Completion engine tests use local fixture history, shell symbol sets, PATH entries, Project directory trees, and CLI specifications. They assert prefix matching, ordering invariants, replacement ranges, path handling, duplicate removal, malformed history handling, and no command-output input.
- zsh Shell Integration tests launch a controlled zsh process when available and assert startup preserves user configuration boundaries, reports prompt and editable-buffer state, accepts whole and partial ghost text, dismisses suggestions, and leaves native `Tab` behavior available.
- Completion UI tests cover local-history ghost text, current-process history, cursor edits, multi-line or unsupported prompt states, full and word acceptance, dismissal, candidates for every first-release source, insertion at the cursor, and fallback when Shell Integration is disabled or fails.
- Security-oriented tests verify untrusted OSC output cannot update trusted editable-buffer state, external links require the modifier, invalid URL schemes are rejected, and all bridge payloads are bounded.
- A real macOS Electron smoke pass is required because fake PTYs cannot validate native ABI, terminal control behavior, or IME. It covers shell startup, PATH and dotfile loading, `vim`, `top`, `ssh` or an equivalent interactive prompt, resize, mouse input, Chinese IME, copy and paste, URL opening, background output while hidden, multiple Terminal Tabs, and cleanup.
- Distribution verification builds the desktop application and a macOS DMG, launches the packaged app, and opens a real terminal. This catches native-module rebuild, unpacking, signing, and path issues that unit tests cannot represent.
- Standard validation includes lint, workspace type checking, relevant Bun tests, the desktop build, and the targeted packaged-app smoke pass.

## Out of Scope

- Windows support, ConPTY integration, and Windows shell profiles.
- Linux packaging and distribution verification.
- Restoring PTY processes, Terminal Tabs, terminal screen contents, active Tab selection, or panel-open state after application restart.
- Split panes, terminal groups inside a Tab, and drag-and-drop Tab reordering.
- Custom terminal profiles, per-Project shell selection, custom fonts, custom themes, and user-configurable color palettes.
- GPU or WebGL rendering; the maintained default xterm renderer is used until measured performance requires another renderer.
- Terminal image protocols, SIXEL, inline media, ligatures, and custom terminal escape-sequence extensions.
- File-path hyperlink detection and opening local files from terminal output.
- Carrent-owned command approval, command allowlists, filesystem sandboxing, privilege escalation, or bypassing macOS privacy authorization.
- Terminal-specific confirmation when closing a Tab or quitting Carrent.
- Persisting command output or creating a Carrent command-history database separate from shell-owned history.
- Sending history, editable command lines, completion requests, or terminal output to an AI model or network service.
- Enhanced history prediction or IDE-style candidates for bash, fish, or shells other than zsh in the first release.
- Full Fig catalog coverage or argument-aware specifications for arbitrary third-party CLIs in the first release.
- Shell Integration decorations, command marks, command navigation, per-command exit badges, current-directory breadcrumbs, and historical command blocks.
- IDE-style command explanations generated dynamically from man pages or online documentation.
- Changing Runtime shell Tool Activity, Agent Activity, Runs, Threads, or Runtime Sessions.
- Adding a new general Electron end-to-end test framework solely for this feature.

## Further Notes

- The canonical product term is Integrated Terminal. A Terminal Tab is one user-visible PTY-backed shell. These terms must remain distinct from Runtime Session, Agent Activity shell commands, and Project Working Directory.
- VS Code, Tabby, and similar Electron applications validate the xterm.js plus `node-pty` architecture. Carrent should reuse the maintained packages while keeping its Project lifecycle and UI local to the Desktop App context.
- Fig's autocomplete repository provides a large MIT-licensed rule catalog but not a directly embeddable Carrent engine. VS Code's MIT-licensed terminal suggestion implementation includes useful rule-processing prior art but depends heavily on VS Code-specific APIs. Reuse should therefore be selective and license-aware.
- The first implementation issue should prove a real PTY in both development and packaged macOS builds before advanced UI work proceeds. Native ABI and packaging are the highest technical risks.
- The second implementation issue completes user-visible terminal ergonomics and Project lifecycle behavior without depending on enhanced completion.
- The third implementation issue adds zsh Shell Integration, local history prediction, and the accepted first set of candidate providers. A failure in this layer must never make the underlying terminal unusable.
- After the first release, the explicitly recorded completion follow-up should evaluate importing more Fig-derived rules, a maintainable specification update process, additional CLI coverage, bash and fish integration, and whether the candidate surface needs user-configurable ranking or triggering.
