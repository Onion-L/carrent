# 01 — Notify background Run outcomes

**What to build:** Send a privacy-safe system notification when a Run completes or fails while its Thread is not already visible in the focused Carrent Window. This establishes the Main Process notification coordination boundary used by later notification behavior.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] A completed Run creates one system notification when the focused Carrent Window is absent, minimized, hidden, in the background, or displaying another Thread.
- [x] A failed Run creates one system notification under the same visibility conditions.
- [x] A focused Carrent Window displaying the exact owning Thread suppresses completion and failure notifications.
- [x] The notification contains only the Thread title and a concise completed or failed state label.
- [x] Message content, Agent Activity, Runtime output, commands, file paths, and failure details never appear in notification content.
- [x] Notifications use the operating system's default sound and defer permission, delivery, history, and Do Not Disturb behavior to the operating system.
- [x] A cancelled Run creates no notification.
- [x] Events without a valid owning Thread create no notification.
- [x] Startup notices, persistence notices, Renderer errors, and other non-Run events remain outside the system notification flow.
- [x] Unsupported notification capability, denied delivery, and notification-construction failure are silent no-ops and do not produce a Renderer toast or alter Run state.
- [x] Peer Carrent Windows and repeated Run-state publication cannot duplicate a notification for one authoritative transition.
- [x] Notification handling is transient Main Process state and adds no App State migration or Settings Tab control.
- [x] Tests exercise the Main Process notification coordinator with fake system notifications, authoritative Run and App State input, and peer-window state.
