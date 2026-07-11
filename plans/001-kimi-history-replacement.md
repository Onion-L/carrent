# Plan 001: Keep Kimi history correct across replacement and recovery sessions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat eb5b839..HEAD -- apps/desktop/src/shared/chat.ts apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/electron/chat/kimiAcpChat.ts apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.ts apps/desktop/electron/chat/chatSessionManager.test.ts`
> If an in-scope file changed, compare the Current state excerpts with the live
> code. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug, tests
- **Planned at**: commit `eb5b839`, 2026-07-11

## Why this matters

Carrent displays local message history while Kimi owns conversation state in an
ACP session. Two paths currently make those histories disagree. Editing an old
user message prunes Carrent's later messages but resumes the Kimi session that
still contains them. Separately, when a persisted Kimi session cannot resume,
Carrent creates a new session but sends only the current message, dropping the
local transcript. Both paths can produce an answer based on the wrong context.

## Current state

- `apps/desktop/CONTEXT.md:83-85` defines a User Message Edit as updating the
  same message, discarding later messages, and starting a replacement run.
- `apps/desktop/src/renderer/components/chat/Composer.tsx:1282-1343` prunes the
  local thread and constructs a transcript that ends before the edited message,
  but the request carries no replacement marker:

```ts
if (externalSubmit?.messageId) {
  updateMessageAndPruneAfter(externalSubmit.messageId, messageText);
}
// ...
const transcriptMessages = externalSubmit?.messageId
  ? props.messages.slice(0, props.messages.findIndex(/* edited message */))
  : props.messages;
// ChatTurnRequest has transcript/message, but no replacement-session signal.
```

- `apps/desktop/electron/chat/chatSessionManager.ts:680-700` always resumes the
  session stored under runtime + scope + thread when one exists:

```ts
const resumeSessionId =
  runtimeSessions.get(requestSessionKey) ??
  options.providerSessions?.get(requestSessionKey) ??
  null;
```

- `apps/desktop/electron/chat/kimiAcpChat.ts:476-505` falls back from
  `session/resume` to `session/new`, but does not report whether the opened
  session is fresh. Lines 296-327 build ACP prompt parts from `request.message`
  and image attachments only; `request.transcript` is ignored.
- The existing transcript formatting and six-message/6000-character limits are
  in `apps/desktop/electron/chat/chatPrompt.ts`. Reuse that behavior instead of
  creating a second transcript limit.
- Tests use `bun:test`, fake ACP transports, `makeRequest` helpers, and explicit
  method assertions. Match `chatSessionManager.test.ts:1775-1836` for resume
  tests and `:1839-1915` for failed-resume fallback tests.
- The existing uncommitted change to
  `apps/desktop/src/renderer/lib/runtimeModelsCache.ts` is user-owned and must
  remain untouched.

## Commands you will need

| Purpose       | Command                                                                                                                                                                    | Expected on success                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Focused tests | `bun test apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts` | all selected tests pass                |
| Full tests    | `bun test`                                                                                                                                                                 | 457 existing tests plus new tests pass |
| Typecheck     | `bun run typecheck`                                                                                                                                                        | exit 0, no errors                      |
| Lint          | `bun run lint`                                                                                                                                                             | exit 0, no warnings or errors          |

## Scope

**In scope**:

- `apps/desktop/src/shared/chat.ts`
- `apps/desktop/src/renderer/components/chat/Composer.tsx`
- `apps/desktop/src/renderer/components/chat/Composer.test.ts`
- `apps/desktop/electron/chat/kimiAcpChat.ts`
- `apps/desktop/electron/chat/kimiAcpChat.test.ts`
- `apps/desktop/electron/chat/chatSessionManager.ts`
- `apps/desktop/electron/chat/chatSessionManager.test.ts`

**Out of scope**:

- Non-Kimi runtime behavior.
- Changing the persisted workspace schema or deleting visible messages beyond
  the existing edit-pruning behavior.
- Changing ACP protocol method names or Kimi-owned session storage.
- `apps/desktop/src/renderer/lib/runtimeModelsCache.ts`.

## Git workflow

- Branch: `codex/plan-001-kimi-history`
- Use a focused commit such as
  `fix(desktop): preserve Kimi context for replacement runs`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Mark replacement turns at the shared request boundary

Add an optional, explicit replacement-history signal to `ChatTurnRequest` in
`src/shared/chat.ts`. Prefer a named field such as `historyMode?: "continue" |
"replace"`; absence must preserve today's continue behavior for persisted
snapshots, tests, and callers.

In `Composer.tsx`, set the replacement value only when
`externalSubmit.messageId` is present. Extract the tiny mapping into an exported
pure helper if needed so `Composer.test.ts` can assert normal submits continue
and edited-message submits replace. Do not infer replacement from transcript
length, because a valid new thread can also have an empty transcript.

**Verify**: `bun test apps/desktop/src/renderer/components/chat/Composer.test.ts`
-> all tests pass, including the two history-mode cases.

### Step 2: Replay bounded local history when Kimi opens a fresh session

Change `KimiAcpRun.openSession()` to return both the ACP config options and
whether `session/resume` succeeded. When the session is fresh and
`request.transcript` is non-empty, build the text ACP part with the existing
`buildChatPrompt()` transcript formatter. Preserve native ACP image parts and
do not also add local attachment paths to the text; pass metadata without
`localPath` to the shared formatter if necessary. A resumed session must still
receive only the current turn so history is not duplicated.

Extend `buildKimiPromptParts` with an explicit option rather than reading hidden
mutable session state. Keep the existing image-only default prompt behavior.

Add tests for:

- fresh session + transcript includes earlier user and assistant text;
- resumed session prompt omits transcript;
- fresh image turn retains native image parts and does not duplicate local
  image paths in text;
- failed resume followed by `session/new` sends the bounded transcript in the
  subsequent `session/prompt`.

**Verify**: `bun test apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts`
-> all selected tests pass.

### Step 3: Fork replacement runs away from the old provider session

In the Kimi branch of `createChatSessionManager.start`, when history mode is
`replace`:

1. Resolve the old session ID for the request session key.
2. Remove that key from the in-memory runtime session map.
3. Await `providerSessions.delete(requestSessionKey, oldSessionId)` when the
   persistent store supports deletion.
4. Start Kimi ACP with `resumeSessionId: null`, allowing Step 2 to reconstruct
   the transcript in a fresh session.

Keep this preparation inside the existing event/error contract: failures must
emit a `failed` event with the original `requestKey`; they must not become an
unhandled rejection. Do not change normal follow-up resume behavior.

Add a regression test with a stored Kimi session and `historyMode: "replace"`.
Assert that `session/resume` is absent, the old persisted key is deleted, a new
session is created, and the prompt includes only the transcript before the
edited message plus the replacement message. Retain the existing normal resume
test unchanged.

**Verify**: `bun test apps/desktop/electron/chat/chatSessionManager.test.ts`
-> all tests pass, including normal resume and replacement-session cases.

### Step 4: Run the repository gates

Run the full suite after focused tests. Do not update snapshots or loosen
assertions to make failures pass.

**Verify**: `bun run lint && bun run typecheck && bun test` -> every command
exits 0.

## Test plan

- `Composer.test.ts`: normal submit maps to continue; edited submit maps to
  replace.
- `kimiAcpChat.test.ts`: fresh transcript text, resumed current-turn-only text,
  and image behavior.
- `chatSessionManager.test.ts`: failed resume replays transcript; replacement
  skips/deletes the old session; normal follow-up still resumes.
- Use the fake ACP transport pattern already present in these files. Do not
  launch a real Kimi process or access the network.

## Done criteria

- [ ] Edited user messages start a new Kimi ACP session.
- [ ] The replacement prompt contains the already-pruned local transcript and
      never contains messages after the edited message.
- [ ] A failed Kimi resume creates a fresh session with bounded local history.
- [ ] Normal Kimi follow-ups still resume without duplicating transcript text.
- [ ] Native image parts still work for fresh and resumed sessions.
- [ ] `bun run lint`, `bun run typecheck`, and `bun test` exit 0.
- [ ] Only in-scope files and `plans/README.md` changed; the pre-existing
      `runtimeModelsCache.ts` diff is byte-for-byte unchanged.

## STOP conditions

Stop and report if:

- Kimi ACP exposes a documented branch/fork API that preserves history up to an
  arbitrary turn; using an explicit protocol feature changes the design.
- The formatter cannot include transcript without converting native images to
  path text; do not silently regress image delivery.
- Provider-session deletion cannot complete before session creation without
  changing the public chat event contract.
- Any non-Kimi runtime test changes behavior.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Future edit/retry/regenerate features must choose an explicit history mode;
  transcript length is not a valid proxy.
- Reviewers should verify the old Kimi session cannot be re-persisted after a
  replacement begins and that failed-resume fallback remains bounded.
- This plan does not delete provider-owned session data from Kimi's own storage;
  it only stops Carrent from resuming the superseded session.
