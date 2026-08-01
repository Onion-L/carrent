# 08 — Verify real multi-window workflows

**What to build:** Verify the complete peer-window experience through cross-module integration coverage and a real macOS Electron smoke pass, fixing any coordination gaps found across shared state, Runs, lifecycle, and Terminal Tabs.

**Blocked by:** 06 — Route, close, and restore Carrent Windows; 07 — Share Project Terminal Tabs across windows.

**Status:** done

- [x] An integration test drives two independent Renderer clients through Workspace, Project, Association, Thread, Draft, Composer, Settings, Run, and Terminal changes and observes one consistent shared result.
- [x] Integration coverage races send, Stop, Approval Request, user-question, Draft promotion, deletion, and terminal focus commands and verifies at most one valid transition for each resource.
- [x] Integration coverage verifies that removing a shared object redirects each affected window independently and never recreates the object from stale state.
- [x] Integration coverage verifies repeated launch, Thread deep-link targeting, individual window closure, zero-window macOS activation, explicit Quit, and restart restoration together with live Runs and Terminal Tabs.
- [x] A real macOS Electron smoke pass opens two Carrent Windows on the same Thread and verifies live message streaming, Composer synchronization, Run controls, Approval Requests or user questions, Settings synchronization, and independent navigation.
- [x] The smoke pass verifies shared Terminal Tabs and output, terminal resize-authority transfer, window closure without PTY or Run termination, and restart restoration without PTY restoration.
- [x] The smoke pass verifies new-window placement from normal and maximized sources and a non-blocking BrowserWindow creation failure path.
- [x] Desktop lint, type checking, targeted Main Process and Renderer tests, the desktop production build, and the existing single-window regression suite pass.
