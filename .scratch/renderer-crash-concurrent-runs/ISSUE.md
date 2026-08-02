# Renderer crash when running two threads concurrently (SIGTRAP / EXC_BREAKPOINT / bug_type 309)

> **Slug**: `renderer-crash-concurrent-runs`
> **Status**: triage:verify
> **Severity**: high (reproducible renderer termination, blocks the headline multi-run workflow)
> **Build**: `Carrent` `0.0.1-alpha02` (`/Applications/Carrent.app`)
> **OS**: macOS 26.2 (25C56), arm64 (Mac17,2)
> **Reported**: 2026-08-02

---

## TL;DR

While running **two chat threads simultaneously**, the renderer process (`Carrent Helper (Renderer)`) crashed twice in a row with `EXC_BREAKPOINT / SIGTRAP` (Chromium `bug_type 309`). Root cause is **not** a single bug but an architectural amplification in the shared-runs / multi-window path: every per-token event is broadcast in full (carrying the entire run history) to every subscribed window, while the renderer applies each event with un-throttled global state updates and never prunes per-run allocations. Two concurrent runs push this into a V8 `CHECK`/OOM and the renderer aborts. The crash on restart (9s after relaunch) confirms the session-restore path re-triggers the same flood.

The app also has **no renderer-crash observability** (`render-process-gone` not handled, no log file), so the only diagnostics are macOS `.ips` files.

---

## Reproduction

1. Open Carrent, open two threads (same window or two windows).
2. Start a run in both threads at roughly the same time (Kimi ACP provider).
3. Let both stream for a while (observed ~1 hour in the captured incident; restart crash came within 9s).
4. Renderer terminates; on auto-restart it terminates again shortly after restore.

Frequency: captured twice back-to-back on 2026-08-02 16:01. Not yet reproduced from a clean build of `main` (see *Open questions*).

---

## Crash reports (verbatim)

Source files (macOS, user-local):

```
~/Library/Logs/DiagnosticReports/Carrent Helper (Renderer)-2026-08-02-160106.ips
~/Library/Logs/DiagnosticReports/Carrent Helper (Renderer)-2026-08-02-160121.ips
```

### Incident 1 — `2026-08-02 16:01:06`

Header:

```json
{
  "app_name": "Carrent Helper (Renderer)",
  "timestamp": "2026-08-02 16:01:06.00 +0800",
  "build_version": "0.0.1-alpha02",
  "bundleID": "com.carrent.desktop.helper.Renderer",
  "bug_type": "309",
  "os_version": "macOS 26.2 (25C56)",
  "incident_id": "01D0D6BE-D10C-4416-8F59-49825FDD8248"
}
```

Exception / termination:

```
exception   : { "type": "EXC_BREAKPOINT", "signal": "SIGTRAP",
                "codes": "0x0000000000000001, 0x00000001103b2580" }
termination : { "namespace": "SIGNAL", "code": 5,
                "indicator": "Trace/BPT trap: 5", "byProc": "exc handler" }
```

Process timing:

```
procLaunch    : 2026-08-02 15:04:34.3327 +0800   ← renderer lived ~56 min before first crash
captureTime   : 2026-08-02 16:01:03.6002 +0800
procRole      : Foreground
parentProc    : Carrent (pid 21130)
faultingThread: 0  name=CrRendererMain  queue=com.apple.main-thread  (61 frames)
```

Faulting thread (CrRendererMain, frames 0–60; all offsets into `Electron Framework`, app is unsymbolicated):

```
   0 Electron Framework 0x55fa580
   1 Electron Framework 0x55fa580
   2 Electron Framework 0x55fa598
   3 Electron Framework 0x55fa5b4
   4 Electron Framework 0x2b36660
   5 Electron Framework 0x3a11d34
   6 Electron Framework 0x3a11cc0
   7 Electron Framework 0x3af92e8
   8 Electron Framework 0x13d57ac
   9 Electron Framework 0x1cf8b54
  10 Electron Framework 0x13d43a0
  11 Electron Framework 0x6605c8
  12 Electron Framework 0x136e694
  13 Electron Framework 0xeb1f6c
  14 Electron Framework 0x136f040
  15 Electron Framework 0x136ed84
  16 Electron Framework 0x136e6a0
  17 Electron Framework 0xeb1f6c
  18 Electron Framework 0x136f040
  19 Electron Framework 0x136ed84
  20 Electron Framework 0x136e6a0
  21 Electron Framework 0x136e228
  22 Electron Framework 0x136e6dc
  23 Electron Framework 0xeb1f6c
  24 Electron Framework 0x136f040
  25 Electron Framework 0x136ed84
  26 Electron Framework 0x136e6a0
  27 Electron Framework 0x136e228
  28 Electron Framework 0x136e6dc
  29 Electron Framework 0xeb1f6c
  30 Electron Framework 0x136f040
  31 Electron Framework 0x136ed84
  32 Electron Framework 0x136e6a0
  33 Electron Framework 0x136e228
  34 Electron Framework 0x136e6dc
  35 Electron Framework 0xeb1f6c
  36 Electron Framework 0xeb1e9c
  37 Electron Framework 0xeb1d84
  38 Electron Framework 0x2b3a4fc
  39 Electron Framework 0x2b3a454
  40 Electron Framework 0x2b53638
  41 Electron Framework 0x520afc8
  42 Electron Framework 0x952c1c
  43 Electron Framework 0x1238e0
  44 Electron Framework 0x1237cc
  45 Electron Framework 0x397da0
  46 Electron Framework 0x1238e0
  47 Electron Framework 0x2ee5f4
  48 Electron Framework 0x10cb4c
  49 Electron Framework 0x10c01c
  50 Electron Framework 0x2824fb4
  51 Electron Framework 0x179f01c
  52 Electron Framework 0x1810568
  53 Electron Framework 0x1aed638
  54 Electron Framework 0x1aeb5a0
  55 Electron Framework 0x1aea2e8
  56 Electron Framework 0x15da9cc
  57 Electron Framework 0x15da4b4
  58 Electron Framework 0x29948d8
  59 Carrent Helper (Renderer) 0x9ce0
  60 dyld 0x8d54
```

VM summary (notable):

```
ReadOnly portion of Libraries: Total=1.9G  swapped_out_or_unallocated=1.9G (100%)
Writable regions: Total=4.8G  written=3333K  unallocated=4.8G (100%)   ← mostly RESERVED, not RSS
Memory Tag 253                    48.0G     4337 regions
Memory Tag 255                     1.3T    14783 regions
Memory Tag 255 (reserved)          320K        5
TOTAL                              1.4T    24766
```

> Note: the 1.4 TB is **virtual** reservation (Metal/GPU/JIT surfaces), not physical memory. The diagnostic signal is the abnormal region **count** (24 766) and the `Memory Tag 255` region count (14 783), which is consistent with runaway allocation rather than normal load.

### Incident 2 — `2026-08-02 16:01:21` (post-restart)

```
incident_id  : 599FF9FE-A71A-4B8D-8145-70ABC1824A95
procLaunch   : 2026-08-02 16:01:11.6526 +0800   ← Electron auto-restarted the renderer
captureTime  : 2026-08-02 16:01:20.7362 +0800   ← crashed ~9s after launch, during restore
exception    : EXC_BREAKPOINT / SIGTRAP (identical signature)
faultingThread: 0  CrRendererMain  (62 frames, same Electron Framework region as Incident 1)
```

Faulting thread (62 frames):

```
   0 Electron Framework 0x55fa580
   1 Electron Framework 0x55fa580
   2 Electron Framework 0x55fa598
   3 Electron Framework 0x55fa5b4
   4 Electron Framework 0x2b36660
   5 Electron Framework 0x3a11d34
   6 Electron Framework 0x3a11cc0
   7 Electron Framework 0x3af92e8
   8 Electron Framework 0x13d57ac
   9 Electron Framework 0x1cf8b54
  10 Electron Framework 0x13d43a0
  11 Electron Framework 0x2bed8
  12 Electron Framework 0x3c4b2cc
  13 Electron Framework 0x136e828
  14 Electron Framework 0xeb1f6c
  15 Electron Framework 0x136f040
  16 Electron Framework 0x136ed84
  17 Electron Framework 0x136e6a0
  18 Electron Framework 0xeb1f6c
  19 Electron Framework 0x136f040
  20 Electron Framework 0x136ed84
  21 Electron Framework 0x136e6a0
  22 Electron Framework 0x136e228
  23 Electron Framework 0x136e6dc
  24 Electron Framework 0xeb1f6c
  25 Electron Framework 0x136f040
  26 Electron Framework 0x136ed84
  27 Electron Framework 0x136e6a0
  28 Electron Framework 0x136e228
  29 Electron Framework 0x136e6dc
  30 Electron Framework 0xeb1f6c
  31 Electron Framework 0x136f040
  32 Electron Framework 0x136ed84
  33 Electron Framework 0x136e6a0
  34 Electron Framework 0x136e228
  35 Electron Framework 0x136e6dc
  36 Electron Framework 0xeb1f6c
  37 Electron Framework 0xeb1e9c
  38 Electron Framework 0xeb1d84
  39 Electron Framework 0x2b3a4fc
  40 Electron Framework 0x2b3a454
  41 Electron Framework 0x2b53638
  42 Electron Framework 0x520afc8
  43 Electron Framework 0x952c1c
  44 Electron Framework 0x1238e0
  45 Electron Framework 0x1237cc
  46 Electron Framework 0x397da0
  47 Electron Framework 0x1238e0
  48 Electron Framework 0x2ee5f4
  49 Electron Framework 0x10cb4c
  50 Electron Framework 0x10c01c
  51 Electron Framework 0x2824fb4
  52 Electron Framework 0x179f01c
  53 Electron Framework 0x1810568
  54 Electron Framework 0x1aed638
  55 Electron Framework 0x1aeb5a0
  56 Electron Framework 0x1aea2e8
  57 Electron Framework 0x15da9cc
  58 Electron Framework 0x15da4b4
  59 Electron Framework 0x29948d8
  60 Carrent Helper (Renderer) 0x9ce0
  61 dyld 0x8d54
```

The 9-second post-restart crash is the key signal: **session restore re-establishes all run subscriptions and replays full event histories at once**, which re-triggers the same flood that killed the first instance.

---

## Analysis

### Crash signature interpretation

`bug_type 309` + `EXC_BREAKPOINT` + `SIGTRAP` on `CrRendererMain` is the canonical signature for Chromium/V8 hitting a `CHECK()`/`DCHECK()` or a hard OOM and calling `abort()`. It is **not** a null-deref (`EXC_BAD_ACCESS`) and **not** a JS exception (those don't terminate the renderer). The frames being all `Electron Framework` (no JS symbolication) is expected for a build that ships without breakpad symbols.

### Why two concurrent runs are the trigger

The shared-runs architecture (commits `3ab11a9 share and serialize runs`, `f6302c8 open and manage peer Carrent Windows`, `d40ed7e persist and restore carrent window sessions`) moved run ownership into a main-process authority that **broadcasts the full authoritative state to every subscribed window on every event**. Verified code path:

1. **Per-token event emission** — `electron/chat/kimiAcpChat.ts:1820-1856`: each `agent_message_chunk` emits **two** events: a `kimi-timeline` item (line 1849) **and** a `delta` (line 1850). Each `agent_thought_chunk` emits another `kimi-timeline` (line 1875). A long Kimi reply is thousands of token chunks → thousands of events per run.

2. **Unbounded event log per run** — `electron/chat/chatRunAuthority.ts:233`:
   ```ts
   let next: SharedChatRun = { ...run, events: [...run.events, authoritativeEvent] };
   ```
   Every event copies and appends to a run-scoped `events` array that is **never trimmed, capped, or rotated** anywhere in the codebase. (`src/shared/chat.ts:354-387` defines the shape with no cap.)

3. **Full-history copy + fan-out per event** — `electron/chat/chatRunAuthority.ts:72-97`:
   ```ts
   function currentState() {
     return { revision, runs: [...runsByThreadId.values()].map((run) => ({
       ...run, events: [...run.events], ...   // ← full copy of EVERY run's ENTIRE history
     }))};
   }
   function publish() {
     revision += 1;
     const state = currentState();
     options.onChange?.(state);
     subscribers.forEach(id => options.publish(id, state));   // ← to every window
   }
   ```
   `publish()` runs **on every event**. With `N` windows × `M` concurrent runs, each token triggers a re-serialization and IPC send of **all runs' complete histories** to every window (`main.ts:576-581` → `contents.send("chat:changed", state)`). Cumulative bytes are quadratic in token count.

4. **Renderer amplifies each event with un-throttled global state churn**:
   - `src/renderer/hooks/useChatRun.ts:271-294` — on each `chat:changed`, replays undelivered events and per event calls `onEventApplied`, `onKimiTimeline`, `onReasoning`, `onDelta`.
   - `src/renderer/components/chat/Composer.tsx` — only the **send path** `onDelta` is throttled via the typewriter (`typewriter.ts`, 24ms/3-char ticks). The **observe path** (`Composer.tsx:1420-1423`, used by a second window watching a shared run) calls `updatePart` per token with no throttle. `onKimiTimeline` and `onReasoning` are un-throttled on **both** paths.
   - Each `updatePart` / `updateThreadContent` does a global snapshot replacement (`AppStateContext.tsx:644-725`), and `updateMessageParts` maps over **all** `threadMessages` (`ThreadContentContext.tsx:942-951`). So one token ⇒ several full-tree re-renders.

**Two concurrent runs double the emission rate while both `events` arrays keep growing**, and the quadratic re-broadcast multiplies it per window. Sustained for ~an hour this is the most plausible path to a V8 `CHECK`/OOM and the observed `SIGTRAP`.

### Secondary: terminal streaming is also un-throttled and unbounded

- `electron/terminal/terminalSessionManager.ts:356-419` — each pty `data` chunk → one IPC message; `session.output += chunk` (line 360) accumulates the **full** scrollback forever and is resent in full on subscribe (lines 281-284).
- `src/renderer/components/terminal/IntegratedTerminal.tsx:290,401-407` — renderer mirrors `retainedOutput` per terminal (unbounded) and writes each chunk straight to xterm with no `requestAnimationFrame`/microtask coalescing.
- Terminal events are single-window targeted (`main.ts:422-426`, by owner `webContents` id), so they don't fan out — but they compound with the chat flood on a window that also has a running terminal.

### Renderer-side leaks that never get cleaned

- `src/renderer/hooks/useChatRun.ts:95` — `deliveredEventCountByRunId` is added to on every replay but **never pruned** when a run terminates (`finishPendingRun`/`clearPending` don't touch it). The coordinator is a module singleton (`useChatRun.ts:505`), so this grows for the whole renderer lifetime.

### No crash observability

Across `electron/` there is:
- no `crashReporter.start()`;
- no `app.on("render-process-gone")` / `webContents.on("render-process-gone")`;
- no `process.on("uncaughtException"|"unhandledRejection")`;
- no `app.getPath("logs")` file writing; diagnostics are bare `console.*` only.

So when the renderer dies, the app leaves nothing behind — the only evidence is the macOS `.ips` the user had to locate manually.

---

## Suggested fixes (ranked)

### P0 — Stop the bleeding (data volume)

1. **Stop broadcasting full history per event.** `chatRunAuthority.ts` should publish **deltas** (the new event + a revision watermark), not the entire `events[]` array, on every event. Full state can be sent once on subscribe. This alone removes the quadratic blow-up. (`chatRunAuthority.ts:72-97, 233`; `main.ts:576-581`)
2. **Cap / rotate per-run event history.** Add a max-events or max-bytes window per run (ring buffer / truncation). Apply the same cap in the renderer `events` mirror. (`shared/chat.ts`, `chatRunAuthority.ts`, `useChatRun.ts`)
3. **Throttle/batch renderer updates on the observe path**, not just the send path. Route `onDelta`, `onKimiTimeline`, `onReasoning` through the typewriter or a `requestAnimationFrame`/microtask coalescer uniformly. (`Composer.tsx:1420-1426` observe path; `typewriter.ts`)
4. **Batch IPC chat updates** on the main side (coalesce publish within a macrotask, e.g. `queueMicrotask`/16ms timer) so a token burst becomes one `chat:changed`, not thousands.

### P1 — Stop the bleeding (terminals)

5. **Coalesce pty output before IPC** (microtask/raf batch) and **cap `session.output`** scrollback with eviction. Mirror the cap in the renderer `retainedOutput`. (`terminalSessionManager.ts:360,281-284`; `IntegratedTerminal.tsx:290,401-407`)

### P2 — Plumb the leaks

6. **Prune `deliveredEventCountByRunId`** (and any sibling per-run maps) when a run terminates. (`useChatRun.ts:95, finishPendingRun/clearPending`)

### P3 — Observability (so the next crash is diagnosable)

7. Handle `webContents.on("render-process-gone")` and log `details.reason` / `exitCode` to a file under `app.getPath("logs")` (resolves to `~/Library/Logs/Carrent/`).
8. Add main-process `process.on("uncaughtException"|"unhandledRejection")` handlers that write to the same log.
9. Consider `crashReporter.start({ uploadToServer: false })` so local minidumps land in `~/Library/Application Support/Carrent/Crashpad/` with proper symbols instead of relying on macOS `.ips`.

---

## Diagnostic / triage commands

```bash
# Open the macOS crash report directory
open ~/Library/Logs/DiagnosticReports/

# Read a specific report
open "~/Library/Logs/DiagnosticReports/Carrent Helper (Renderer)-2026-08-02-160121.ips"

# Launch from terminal to capture renderer JS stderr live (often more useful than .ips)
/Applications/Carrent.app/Contents/MacOS/Carrent

# Bisect a GPU/Metal-init suspected abort (SIGTRAP during startup/restore is GPU-suspicious)
/Applications/Carrent.app/Contents/MacOS/Carrent --disable-gpu

# Rebuild the only native dep against the current Electron (ABI mismatch aborts at startup)
cd apps/desktop && bunx electron-rebuild   # or: bun run rebuild
```

---

## Open questions / validation needed

- **Reproduce on `main`.** The captured crash is from installed `alpha02`. `alpha03` currently exists **only** as an uncommitted version bump in `apps/desktop/package.json` (no code change since `a5dfe73`), so behavior is expected to be identical — but reproduction from a clean build still needs to be confirmed before claiming the bug is present on `main`.
- **Confirm vector.** The full-history-rebroadcast + un-throttled-observe theory is consistent with the signature and the 9s post-restart crash, but the renderer is unsymbolicated, so the exact `CHECK` is not provable from the `.ips` alone. Symbolicating (P3 #9) or capturing live stderr during repro will confirm.
- **Is GPU/Metal implicated?** The huge reserved VM and SIGTRAP-on-main during restore could also be a Skia/GPU surface abort. The `--disable-gpu` bisect above settles this quickly.

---

## Key files / line references

| Area | Path | Lines |
| --- | --- | --- |
| Full-history copy + fan-out | `apps/desktop/electron/chat/chatRunAuthority.ts` | 72-97, 233 |
| Per-window broadcast | `apps/desktop/electron/main.ts` | 570-582 |
| Per-token double event emit | `apps/desktop/electron/chat/kimiAcpChat.ts` | 1820-1876 |
| Renderer replay loop | `apps/desktop/src/renderer/hooks/useChatRun.ts` | 95, 271-294, 505 |
| Un-throttled observe path | `apps/desktop/src/renderer/components/chat/Composer.tsx` | 1420-1426 |
| Throttled send-path only | `apps/desktop/src/renderer/components/chat/typewriter.ts` | 1-21 |
| Global snapshot churn | `apps/desktop/src/renderer/context/AppStateContext.tsx` | 644-725 |
| Full-message-map updates | `apps/desktop/src/renderer/context/ThreadContentContext.tsx` | 942-951 |
| Unbounded run event shape | `apps/desktop/src/shared/chat.ts` | 354-387 |
| Unbounded terminal output (main) | `apps/desktop/electron/terminal/terminalSessionManager.ts` | 281-284, 356-419 |
| Unbounded terminal output (renderer) | `apps/desktop/src/renderer/components/terminal/IntegratedTerminal.tsx` | 290, 401-407 |

---

## Related commits

- `3ab11a9` feat(desktop): share and serialize runs
- `f6302c8` feat(desktop): open and manage peer Carrent Windows
- `d40ed7e` feat(desktop): persist and restore carrent window sessions
- `2cf946b` feat(desktop): share project terminal tabs across windows
- `61cc6ab` feat(desktop): unify Kimi tool timeline
- `887469c` feat(desktop): add Kimi thinking timeline
