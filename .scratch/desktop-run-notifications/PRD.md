# Desktop Run Notifications PRD

Status: done

## Problem Statement

Carrent can keep a Run active while its Thread is not visible in the focused Carrent Window. A user may switch to another Thread, minimize Carrent, place it behind another application, or close every Carrent Window on macOS while the application remains alive. When the Run completes, fails, or needs an answer or Approval Request, Carrent currently gives the user no operating-system notification. The user must repeatedly return to Carrent and inspect Thread Status to discover whether work finished or needs attention.

Existing Renderer toasts do not solve this problem because they are visible only inside a Carrent Window and are intended for short-lived in-app feedback. Carrent needs system notifications that follow the authoritative shared Run and Thread state, avoid duplicates across peer Carrent Windows, preserve notification privacy, and return the user to the correct Thread when clicked.

## Solution

Carrent sends one system notification when a Run completes, fails, enters waiting-for-answer, or enters waiting-for-approval while its Thread is not displayed by the focused Carrent Window. A focused Carrent Window already displaying that Thread suppresses the notification. Carrent being in the background, minimized, hidden, showing a different Thread, or having no open Carrent Window permits the notification.

Each notification contains only the Thread title and a concise state label. It never includes message content, question text, Approval Request details, commands, file paths, or error details. Notifications use the operating system's default sound and respect system notification permissions and Do Not Disturb settings.

Clicking a notification focuses the most recently active Carrent Window already displaying the Thread. If no window displays it, Carrent reuses the most recently active window and navigates it to the Thread. If no Carrent Window exists, Carrent creates one and opens the Thread. A Thread keeps at most one current notification, so a later state replaces an obsolete earlier notification.

Completion is notified only when the Run finishes successfully and no automatically continuing queued message remains. Intermediate successful Runs in a queued sequence do not notify. Failure and attention-required states notify immediately. User-requested cancellation does not notify. Unsupported notifications or denied system permission are handled silently.

## User Stories

1. As a Carrent user, I want a system notification when a background Run completes, so that I know when the requested work is ready to review.
2. As a Carrent user, I want a system notification when a background Run fails, so that I can return and decide how to recover.
3. As a Carrent user, I want a system notification when a Run waits for my answer, so that the Coding Agent does not remain blocked unnoticed.
4. As a Carrent user, I want a system notification when a Run waits for an Approval Request, so that I can make the required decision promptly.
5. As a Carrent user, I want notifications tied to a specific Thread, so that generic application events do not create distracting system alerts.
6. As a Carrent user, I want startup notices, persistence recovery notices, ordinary errors, and Renderer toasts to remain in-app only, so that system notifications are reserved for Run outcomes and required interactions.
7. As a Carrent user, I want no notification when the focused Carrent Window already displays the affected Thread, so that visible state changes are not reported twice.
8. As a Carrent user, I want a notification when Carrent is focused but I am viewing another Thread, so that work outside my current view can request attention.
9. As a Carrent user, I want a notification when Carrent is behind another application, so that I do not need to poll it manually.
10. As a Carrent user, I want a notification when the relevant Carrent Window is minimized or hidden, so that an inaccessible visible route does not suppress attention.
11. As a Carrent user, I want a notification when no Carrent Window is open but Carrent is still running, so that closing the last window on macOS does not hide Run progress.
12. As a Carrent user, I want one notification per state transition regardless of how many Carrent Windows observe the Thread, so that peer windows do not produce duplicates.
13. As a Carrent user, I want entering waiting-for-answer to notify only once for that waiting phase, so that additional question state updates do not create repeated alerts.
14. As a Carrent user, I want entering waiting-for-approval to notify only once for that waiting phase, so that repeated protocol events do not create repeated alerts.
15. As a Carrent user, I want another notification if the Run resumes and later enters a new waiting phase, so that a distinct later request is not hidden by earlier deduplication.
16. As a Carrent user, I want Approval Request precedence to remain consistent with Thread Status, so that the notification describes the interaction Carrent currently considers most urgent.
17. As a Carrent user, I want a successful Run with automatically continuing queued work not to claim that the Thread is finished, so that notifications remain truthful.
18. As a Carrent user, I want one completion notification after the queued sequence becomes idle, so that I am alerted only when the requested sequence is actually ready.
19. As a Carrent user, I want a queued sequence failure to notify immediately, so that later queued work does not hide a failed Run.
20. As a Carrent user, I want user-requested cancellation to remain silent, so that an action I initiated is not reported back as a failure.
21. As a Carrent user, I want unexpected Runtime or process failures to be reported as failure, so that genuine problems are distinguishable from cancellation.
22. As a Carrent user, I want the Thread title in the notification, so that I can identify which conversation needs attention.
23. As a Carrent user, I want a concise completion, failure, answer-needed, or approval-needed label, so that I can understand the notification without opening Carrent.
24. As a Carrent user, I want chat messages excluded from notifications, so that private project context is not exposed on the lock screen or notification center.
25. As a Carrent user, I want structured question text and choices excluded from notifications, so that potentially sensitive prompts stay inside Carrent.
26. As a Carrent user, I want Approval Request details and commands excluded from notifications, so that controlled actions are not disclosed outside the Agent GUI.
27. As a Carrent user, I want error details and local paths excluded from notifications, so that diagnostic data remains inside the Thread.
28. As a Carrent user, I want system notifications to use the default operating-system sound, so that Carrent behaves like other desktop applications.
29. As a Carrent user, I want Carrent notifications to respect Do Not Disturb and operating-system notification settings, so that my system-wide attention preferences remain authoritative.
30. As a Carrent user, I want no separate Carrent notification preference in the first delivery, so that notification behavior has one clear source of control.
31. As a Carrent user, I want denied or unsupported notifications to fail silently, so that the absence of an optional system surface does not create another error.
32. As a Carrent user, I want clicking a notification to focus a Carrent Window already showing its Thread, so that my existing window layout is preserved.
33. As a Carrent user, I want the most recently active matching window chosen when several windows show the Thread, so that notification navigation follows my recent work context.
34. As a Carrent user, I want the most recently active window reused when no window shows the Thread, so that clicking a notification does not create unnecessary windows.
35. As a Carrent user, I want a new Carrent Window created when no window exists, so that a notification remains actionable after all windows are closed.
36. As a Carrent user, I want a minimized matching window restored before it is focused, so that clicking the notification makes the Thread visible.
37. As a Carrent user, I want a hidden matching window shown before it is focused, so that clicking the notification has an observable result.
38. As a Carrent user, I want a newer state notification to replace an older notification for the same Thread, so that the notification center does not retain obsolete requests.
39. As a Carrent user, I want a completion notification to replace an earlier attention-required notification after I respond and the Run finishes, so that the latest Thread state is authoritative.
40. As a Carrent developer, I want notification decisions made once in the Main Process, so that peer Renderers cannot race or duplicate system notifications.
41. As a Carrent developer, I want notification state derived from authoritative Run and App State, so that system notifications agree with shared Thread Status and queued work.
42. As a Carrent developer, I want notification navigation to use the existing peer-window registry, so that notification clicks follow established activation and route targeting behavior.
43. As a Carrent developer, I want notification creation behind a small system adapter, so that behavior can be tested without relying on the host notification center.
44. As a Carrent maintainer, I want the complete feature tested at one Main Process coordination boundary, so that state transitions, suppression, replacement, and click routing are verified together.

## Implementation Decisions

- System notifications are a Main Process responsibility because Run state, App State, and peer Carrent Window coordination are shared application concerns.
- Add one notification coordinator that consumes authoritative Run transitions, resolves the owning Thread and its queued work from the current App State Snapshot, inspects Carrent Window routes and focus state, and invokes a system notification adapter.
- The coordinator is invoked once for authoritative state changes rather than once per Renderer subscription or broadcast.
- The system notification adapter exposes support detection, notification creation, click handling, closing, and the operating system's default sound behavior. It does not expose custom sound or volume controls.
- Notification candidates are limited to Run transitions into `completed`, `failed`, `waiting-for-answer`, and `waiting-for-approval`.
- A `cancelled` Run never creates a notification. User-requested cancellation is not converted to failure for notification purposes.
- Completion is eligible only when the owning Thread has no queued message that will automatically start another Run. Intermediate completion in an automatically continuing queue is suppressed; the final successful Run produces the single completion notification.
- Waiting notifications are transition-based. Additional Approval Requests, questions, event replay, subscription replay, or state publication while the Run remains in the same waiting phase do not create another notification.
- Returning from a waiting state to running resets that waiting phase. A later transition back to a waiting state is independently eligible.
- Notification suppression checks the focused Carrent Window only. Suppress when that focused window's current route is the exact owning Thread route. A matching route in an unfocused, minimized, hidden, or background window does not suppress notification creation.
- Thread route construction uses the Thread's fixed Workspace and Project relationships from authoritative App State.
- Notification content consists of the Thread title and one concise English state label for completed, failed, answer needed, or approval needed. Carrent's current desktop interface is English-only.
- Notification content must not include message text, Agent Activity, structured questions, answers, Approval Request metadata, commands, file paths, Runtime output, or failure details.
- Carrent requests normal system notification behavior with the default sound and delegates permission, delivery, history, and Do Not Disturb behavior to the operating system.
- The first delivery adds no Settings Tab control, persisted preference, custom permission screen, custom sound, volume, or quiet-hours logic.
- Unsupported system notifications, construction failures, and denied delivery are silently ignored. They do not create a Renderer toast or change Run state.
- Keep at most one live notification handle per Thread. Before showing a later notification for the Thread, close and replace its earlier handle.
- Notification handling is process-local and is not persisted across application restart.
- Clicking a notification first asks the peer-window registry to target the owning Thread route. The registry focuses the most recently active matching window; otherwise it navigates and focuses the most recently active window.
- If no Carrent Window exists, notification click creates a recovered peer window with the owning Thread route as its initial route.
- Focusing a notification target restores a minimized window and shows a hidden window before focus, following existing window activation behavior.
- Multi-window notification behavior must remain compatible with the peer Carrent Window architecture in ADR-0012: windows keep independent routes and presentation state while shared notification decisions remain under Main Process authority.
- No App State schema migration is required. Notification handles and transition-deduplication state are transient Main Process state.

## Testing Decisions

- Good tests assert externally observable notification and navigation behavior, not private maps, individual helper calls, Electron internals, or implementation-specific timers.
- Use one primary test seam: the Main Process notification coordinator with injected authoritative Run state, current App State Snapshot access, a peer-window registry, a fake system notification adapter, and a window-creation callback.
- The primary seam records created notification title/body values, sound behavior, closed notification handles, and click callbacks, then observes window focus, restore, show, navigation, or creation effects.
- Test successful completion with no queued continuation, failure, waiting-for-answer, and waiting-for-approval.
- Test that the focused Carrent Window on the exact Thread route suppresses each eligible notification.
- Test that a focused window on another Thread, an unfocused matching window, a minimized matching window, a hidden matching window, application background state, and zero-window state do not suppress notification creation.
- Test that multiple Carrent Window subscribers and repeated authoritative publication produce exactly one notification for one transition.
- Test that additional events within one waiting phase do not notify again, while resuming and entering a later waiting phase does.
- Test Thread Status precedence when questions and Approval Requests coexist, including replacement of an answer-needed notification by the current approval-needed state when a distinct transition requires it.
- Test that automatically continuing queued work suppresses intermediate completion and that the final queue-draining completion notifies once.
- Test that failure during queued work notifies immediately.
- Test that user-requested cancellation produces no notification.
- Test that a newer notification for one Thread closes and replaces the previous notification for that Thread without affecting notifications for other Threads.
- Test that notification content contains only the Thread title and state label, with no message, question, Approval Request, command, path, Runtime output, or error detail.
- Test unsupported notification capability, denied delivery, and notification-construction failure as silent no-ops that leave Run state unchanged.
- Test click routing to the most recently active matching window, fallback navigation and focus of the most recently active non-matching window, restoration/showing of non-visible targets, and new-window creation when no Carrent Window exists.
- Test a stale or missing Thread candidate as a silent no-op rather than producing a generic notification without Thread context.
- Existing prior art includes Main Process multi-window workflow tests, Chat Run authority transition tests, Carrent Window registry activation and deep-link tests, and dependency-injected quit-warning dialog tests.
- No Renderer component test is required because the feature adds no Renderer UI and existing in-app toast behavior remains unchanged.

## Out of Scope

- Notifications without a specific Thread and Run context.
- System notifications for application startup, updates, App State recovery, persistence errors, Runtime Setup, Terminal Tabs, Thread Actions, Subagent Tasks, or ordinary Renderer errors.
- Replacing existing Renderer toasts or confirmation dialogs.
- Showing chat content, Agent Activity, structured questions, Approval Request details, commands, paths, Runtime output, or error details in a system notification.
- User-configurable notification settings, per-event controls, custom sounds, volume controls, quiet hours, schedules, or an in-app permission flow.
- Notification badges, dock badges, tray icons, menu-bar items, a notification center, or notification history inside Carrent.
- Notification actions such as approve, answer, retry, stop, or dismiss from the operating-system notification itself.
- Persisting notification handles or deduplication state across Carrent restarts.
- Sending notifications after Carrent has quit or running a separate background service.
- Treating a user-requested Run cancellation as failure.
- Changing the content or precedence rules of existing Thread Status beyond consuming them for notification decisions.
- Changing the message queue's ordering, steering, recovery, or automatic-send behavior.
- Adding notification localization while the desktop interface remains English-only.

## Further Notes

- This PRD uses the Desktop App context terms Carrent Window, App State Snapshot, Thread, Run, Thread Status, Approval Request, Coding Agent, Runtime, Agent Activity, and Settings Tab.
- “Task” in the initial request maps to a Carrent Thread containing a Run. Notifications report Run state but navigate to and deduplicate by the owning Thread.
- Existing Renderer toasts remain appropriate for feedback visible inside Carrent; system notifications are limited to background Run outcomes and attention requests.
- ADR-0012 remains compatible with this design and supports placing notification authority in the Main Process.
