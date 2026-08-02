# 02 — Notify when a Run needs attention

**What to build:** Notify the user when a background Run enters waiting-for-answer or waiting-for-approval, without repeating alerts during the same waiting phase and without leaving an obsolete notification for the Thread.

**Blocked by:** 01 — Notify background Run outcomes

**Status:** ready-for-agent

- [x] A Run entering waiting-for-answer creates one system notification when its Thread is not displayed by the focused Carrent Window.
- [x] A Run entering waiting-for-approval creates one system notification under the same visibility conditions.
- [x] A focused Carrent Window displaying the exact owning Thread suppresses both attention notifications.
- [x] Additional questions, Approval Requests, event replay, or state publication while the Run remains in the same waiting phase do not create another notification.
- [x] Resolving the pending interaction and returning to running resets the waiting phase so a later transition can notify again.
- [x] Waiting-for-approval takes precedence over waiting-for-answer in accordance with Thread Status.
- [x] A distinct transition from waiting-for-answer to waiting-for-approval replaces the Thread's earlier notification with the current state.
- [x] Before any later notification is shown for a Thread, its previous live notification handle is closed.
- [x] Replacing one Thread's notification does not close or alter notifications belonging to other Threads.
- [x] Attention notifications contain only the Thread title and a concise answer-needed or approval-needed label.
- [x] Structured question text, answers, Approval Request details, commands, and other interaction metadata never appear in notification content.
- [x] Tests cover transition-based deduplication, resumed and repeated waiting phases, Thread Status precedence, per-Thread replacement, and multi-window suppression through the shared Main Process coordinator boundary.
