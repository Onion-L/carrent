# 05 — Open and manage peer Carrent Windows

**What to build:** Let a user open a Thread in a new peer Carrent Window with complete application navigation, independent window-owned navigation state, predictable placement, and failure handling that leaves existing windows untouched.

**Blocked by:** 04 — Share and serialize Runs.

**Status:** done

- [x] The Thread context menu contains `Open in new window` and opens the selected Thread directly in a new peer Carrent Window.
- [x] Every Carrent Window provides complete Workspace, Project, Thread, and Settings navigation without a privileged Main Window or restricted secondary window.
- [x] The source and new windows can independently navigate, use Back and Forward, select different objects, and change transient presentation state.
- [x] The same Thread can remain open and usable in more than one Carrent Window.
- [x] A new window opens on the source window's display, inherits its normal bounds, and applies an approximately 24-pixel clamped cascade offset within the display work area.
- [x] A maximized source window does not make the new window start maximized.
- [x] Closing one of several Carrent Windows destroys only that window and does not stop Runs, discard shared state, or quit Carrent.
- [x] Carrent applies no product-level window count limit.
- [x] BrowserWindow creation failure leaves all existing windows unchanged and shows a non-blocking error in the source window.
- [x] No global new-window shortcut, File menu command, permanent title-bar action, empty window command, or auxiliary-window role is introduced.
- [x] Main-process and Renderer tests cover window registration, activation order, Renderer readiness, creation geometry, independent routes, the Thread menu action, closure, and creation failure.

