# 03 — Synchronize Thread Drafts and Thread Composer State

**What to build:** Give each Workspace-Project Association one shared Thread Draft and each existing Thread one shared Thread Composer State that stays consistent across Renderer clients, including promotion, attachments, configuration, messages, and destructive lifecycle changes.

**Blocked by:** 02 — Synchronize shared application data and Settings.

**Status:** done

- [x] Text, attachments, Runtime, model, run mode, and Plan Mode changes to an Association's Thread Draft appear in every Renderer showing that Association.
- [x] Text, attachments, Runtime, model, run mode, and Plan Mode changes to an existing Thread Composer State appear in every Renderer showing that Thread.
- [x] Draft and Composer updates are revisioned so a delayed update cannot replace newer text, configuration, or attachments.
- [x] Concurrent promotion of the same Thread Draft creates at most one Thread and one initial user message, and every Renderer resolves to that result.
- [x] Promoting or discarding a Thread Draft removes it everywhere without a stale Renderer recreating it.
- [x] Persisted messages, Thread work, queues, Run Checklists, and attachment references update through authoritative commands rather than competing Renderer snapshots.
- [x] Thread deletion, Association removal, Workspace deletion, and Project relocation transactions publish their committed state to every Renderer while retaining their existing atomic rollback behavior.
- [x] The legacy Renderer full-snapshot stage and save path is removed after all App State callers have moved to commands and subscriptions.
- [x] Two-client Renderer tests cover simultaneous Draft and Composer editing, attachment changes, configuration changes, promotion races, deletion, stale rejection, and restart persistence.


## Comments

- 2026-08-01: Implemented in commit afee0c1. Drafts, promotion, thread content, composer work, and run/action records moved to authority commands; promotion races create at most one thread/message; transactions broadcast committed snapshots; legacy full-snapshot stage/save path removed; quit flush via `app-state:flush-request`/`flush-done` + authority `waitForIdle()`. Full suite 1261 tests green.
