# 04 — Share and serialize Runs

**What to build:** Make each Thread's live Run and pending interactions application-level state that every Renderer can observe and control, with the Main Process accepting only the first valid transition for send, Stop, Approval Requests, and user questions.

**Blocked by:** 03 — Synchronize Thread Drafts and Thread Composer State.

**Status:** done

- [x] Run start, streaming messages, Agent Activity, Thread Status, Run Checklist, completion, failure, and cancellation are broadcast to every Renderer showing the Thread.
- [x] A Renderer that subscribes after a Run starts receives the current Run, pending Approval Requests, pending user questions, and accumulated visible Thread state.
- [x] Any Renderer showing a Thread can send its shared Composer State, stop the live Run, answer an Approval Request, or answer a user question.
- [x] Concurrent sends for one Thread start at most one Run and create no duplicate user or assistant messages.
- [x] Duplicate or stale Stop, Approval Request, and user-question responses do not execute again and return the latest accepted state to the caller.
- [x] Reloading or closing one Renderer does not stop a Run or interrupt its pending interactions while Carrent remains active.
- [x] Explicit application Quit retains the existing live-Run confirmation and cancels Runs only after confirmation.
- [x] Main-process tests cover Run fan-out, late subscribers, command races, stale responses, Renderer reload and closure, and explicit Quit.
- [x] Two-client Renderer tests cover simultaneous Thread display, live streaming, Run controls, Approval Requests, user questions, Agent Activity, and Run Checklist synchronization.
