# 01 — Establish Main Process App State authority

**What to build:** Establish one revisioned, Main Process-owned source of truth for shared Carrent application data while preserving the current single-window experience. Renderer clients submit bounded commands instead of deciding which complete snapshot wins, and every accepted transition is persisted and published consistently.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The Main Process initializes authoritative application state from the established persisted App State and recovery result.
- [ ] Every accepted command advances a monotonic revision, persists the resulting state, and publishes the same revision and state to every subscribed Renderer client.
- [ ] Commands carry stable identities so retrying an accepted command does not apply it twice.
- [ ] A stale or invalid command is rejected without mutating state, and its caller receives the latest authoritative revision and state needed to recover.
- [ ] Concurrent commands are serialized against the latest accepted state rather than racing independent snapshot writes.
- [ ] Existing corruption recovery, Full Reset, atomic persistence, and transaction gating remain authoritative and cannot be bypassed by commands or subscriptions.
- [ ] Unmigrated single-window callers continue working during the expansion phase, and this ticket does not expose a second Carrent Window.
- [ ] Main-process tests exercise two simulated Renderer clients, accepted commands, duplicate commands, stale commands, persistence failure, recovery gating, and ordered broadcasts.

