# 03 — Open the Thread from a notification

**What to build:** Make every Run notification actionable by taking the user to its owning Thread while preserving Carrent's peer-window activation and reuse behavior.

**Blocked by:** 01 — Notify background Run outcomes

**Status:** ready-for-agent

- [x] Clicking a notification focuses the most recently active Carrent Window already displaying the owning Thread.
- [x] When no Carrent Window displays the Thread, clicking reuses the most recently active window, navigates it to the Thread, and focuses it.
- [x] A minimized target window is restored before focus.
- [x] A hidden target window is shown before focus.
- [x] When no Carrent Window exists, clicking creates a recovered peer window whose initial route is the owning Thread.
- [x] Clicking a notification does not create a new window when an existing Carrent Window can be reused.
- [x] When several Carrent Windows display the Thread, the most recently active matching window is chosen.
- [x] Thread targeting uses the Thread's fixed Workspace and Project relationships from authoritative App State.
- [x] Navigation continues to use the existing nearest-valid-parent behavior if the route becomes stale before the user clicks.
- [x] Tests invoke the fake system notification's click callback and assert focus, restore, show, navigation, selection among peer windows, and zero-window creation behavior at the Main Process coordinator boundary.
