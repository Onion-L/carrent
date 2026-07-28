# Compact Thread Context PRD

Status: ready-for-agent

## Problem Statement

Carrent preserves long-lived Thread history and Runtime Session continuity, but it does not give users a Carrent-owned way to invoke a Runtime's context-compaction capability. As a Thread grows, users must leave Carrent or manually send Runtime-specific slash commands, which can incorrectly appear as normal conversation, create Run lifecycle state, and provide no reliable history boundary showing when the Runtime context changed.

The existing Composer slash menu already exposes Plan Mode and Skills, and Kimi ACP advertises a native `compact` command. Carrent needs a deliberate Thread Action that invokes this capability without pretending it is a user request or Agent reply, while keeping availability, progress, persistence, and failure behavior understandable.

## Solution

Carrent adds `Compact` to the existing `/` menu immediately after `Plan mode` and before the `Skills` group. The action has no icon and no visible group heading. It is shown only when the current Runtime explicitly supports Compact, the Thread has a resumable Runtime Session, the Thread is idle, and at least one complete user-request-to-Agent-response exchange has occurred since the latest successful Compact for that Runtime.

Selecting `Compact`, or submitting a leading `/compact` command, immediately invokes the current Runtime's native context-compaction capability without creating a Run. Carrent keeps draft content and attachments, blocks sending for the affected Thread, shows `Compacting` state, permits navigation and work in other Threads, and applies a five-minute timeout without offering cancellation.

After the Runtime confirms success, Carrent appends a persistent `Context compacted` timeline divider, updates Thread Activity Time, refreshes context usage, and hides Compact until another complete exchange occurs. Failure produces no divider, does not retry automatically, restores the Composer, and reports a concise error.

## User Stories

1. As a Carrent user, I want Compact available from the existing `/` menu, so that context maintenance is available where I already discover Thread Actions.
2. As a Carrent user, I want `Plan mode` to remain the first Thread Action, so that adding Compact does not reorder an established command.
3. As a Carrent user, I want `Compact` immediately after `Plan mode`, so that Thread Actions remain together before Skills.
4. As a Carrent user, I want the existing `Skills` group to remain after Thread Actions, so that skills and direct Thread controls remain distinguishable.
5. As a Carrent user, I want no visible Thread Actions heading, so that the command menu stays compact.
6. As a Carrent user, I want Compact rendered without an icon, so that it matches the other text-only commands in this menu.
7. As a Carrent user, I want typing `/co` to filter the menu to Compact, so that keyboard discovery is fast.
8. As a Carrent user, I want selecting Compact to execute immediately, so that I do not need a second confirmation.
9. As a Carrent user, I want submitting `/compact` to behave like selecting the menu item, so that keyboard execution is predictable.
10. As a Carrent user, I want a leading `/compact` followed by draft text to execute Compact without sending that text, so that the text remains available for my next request.
11. As a Carrent user, I want the `/compact` command token removed after execution, so that Runtime-specific control text does not remain in my draft.
12. As a Carrent user, I want all text after `/compact` preserved as an unsent draft, so that context maintenance never discards my work.
13. As a Carrent user, I want pending attachments preserved when I invoke Compact, so that I do not need to attach them again.
14. As a Carrent user, I want to keep editing the Composer while Compact runs, so that I can prepare my next request.
15. As a Carrent user, I want sending disabled while Compact runs, so that a new request cannot race with Runtime context mutation.
16. As a Carrent user, I want the selected Thread to show a concise compacting state in the Composer, so that I know why sending is unavailable.
17. As a Carrent user, I want the owning Thread to show `Compacting` in Thread navigation, so that background progress remains visible after I navigate away.
18. As a Carrent user, I want to navigate away while Compact runs, so that a maintenance operation does not trap me in one Thread.
19. As a Carrent user, I want other Threads to remain fully usable while one Thread is compacting, so that independent Runtime Sessions do not block each other.
20. As a Carrent user, I want Compact hidden while the current Thread has a live Run, so that conflicting Runtime Session operations cannot be started.
21. As a Carrent user, I want Compact hidden while the current Thread is already compacting, so that duplicate compaction cannot be started.
22. As a Carrent user, I want a manually submitted `/compact` rejected while the Thread is running, so that it cannot enter the queued-message flow as a normal request.
23. As a Carrent user, I want draft text after a rejected `/compact` preserved, so that an unavailable action does not destroy my request.
24. As a Carrent user, I want Compact hidden before the Thread has a complete exchange, so that Carrent does not offer to compress an empty or incomplete context.
25. As a Carrent user, I want a complete exchange to require both my persisted request and an effective Agent reply from a completed Run, so that message count alone does not imply compressible context.
26. As a Carrent user, I want a completed Plan Review to count as an effective Agent reply, so that planning conversations can be compacted.
27. As a Carrent user, I want a failed or cancelled first Run without an effective Agent reply excluded, so that incomplete work does not unlock Compact.
28. As a Carrent user, I want drafts, queued messages, errors, Checklists, and Compact dividers excluded from the complete-exchange rule, so that only real conversation unlocks Compact.
29. As a Carrent user, I want Compact hidden when no resumable Runtime Session exists, so that Carrent never offers an action with no Runtime context to mutate.
30. As a Carrent user, I want Compact hidden when the installed Runtime version does not support it, so that unsupported commands are not exposed optimistically.
31. As a Carrent user, I want a manually submitted `/compact` rejected when Compact is unavailable, so that it cannot accidentally become a normal Agent request.
32. As a Carrent user, I want the unavailable-command error to explain the relevant reason, so that I understand whether the Thread needs a completed exchange, a Runtime Session, an idle state, or Runtime support.
33. As a Carrent user, I want Compact available at any positive context usage after the other conditions are met, so that Carrent does not impose an arbitrary threshold.
34. As a Carrent user, I want the menu description to show current context usage, so that I can judge whether compaction is worthwhile.
35. As a Carrent user, I want the description to read like `Compress this thread's context (34% used)`, so that the action and its current value are clear.
36. As a Carrent user, I want Compact to use the Runtime's default compaction strategy, so that I do not need to configure summarization instructions.
37. As a Carrent user, I want Compact to remain separate from Run history, so that context maintenance is not presented as coding work.
38. As a Carrent user, I want Compact to create no user message or Agent message, so that conversation history remains truthful.
39. As a Carrent user, I want Compact to create no Run Checklist, Agent Activity, file changes, approval flow, or question flow, so that unrelated Run surfaces remain unchanged.
40. As a Carrent user, I want a successful Compact represented by a horizontal timeline divider labeled `Context compacted`, so that later conversation has a visible context boundary.
41. As a Carrent user, I want the divider displayed without an avatar, bubble, icon, or timestamp, so that it reads as Carrent-owned history rather than a participant message.
42. As a Carrent user, I want the divider persisted across Thread navigation and application restart, so that the context boundary remains trustworthy.
43. As a Carrent user, I want repeated successful Compact operations separated by intervening conversations to retain separate dividers, so that each context transition is visible.
44. As a Carrent user, I want no success Toast after Compact, so that the persistent divider is the single success feedback.
45. As a Carrent user, I want Thread Activity Time updated only after Compact succeeds, so that recent activity reflects a real persistent change.
46. As a Carrent user, I want context usage refreshed after Compact succeeds, so that the Composer indicator and future menu description show the reduced context.
47. As a Carrent user, I want Compact hidden after success until another complete exchange occurs, so that I cannot repeatedly degrade the same compacted summary.
48. As a Carrent user, I want a failed Compact to create no timeline divider, so that history never claims an unconfirmed context change.
49. As a Carrent user, I want a failed Compact to restore normal Composer behavior and show a concise error, so that I can recover without restarting.
50. As a Carrent user, I want Compact failures not retried automatically, so that Carrent does not repeat a potentially expensive Runtime operation without consent.
51. As a Carrent user, I want an invalid Runtime Session mapping removed after an explicit invalid-session response, so that future actions do not repeatedly target a dead Session.
52. As a Carrent user, I want my next normal Run to establish a fresh Runtime Session from persisted conversation after invalid-session cleanup, so that the Thread remains usable.
53. As a Carrent user, I want Compact to time out after five minutes, so that a hung Runtime cannot block the Thread forever.
54. As a Carrent user, I want no cancel control during Compact, so that the action has one simple completion path.
55. As a Carrent user, I want a timed-out Compact treated as failure, so that uncertain Runtime state is never presented as confirmed success.
56. As a Carrent user, I want closing or crashing Carrent during Compact to produce no recovered operation or inferred success divider after restart, so that Carrent does not guess an outcome it did not observe.
57. As a keyboard user, I want Compact selectable with the existing slash-menu keyboard navigation, so that it does not require pointer input.
58. As a screen-reader user, I want the Compact command, usage description, unavailable feedback, and compacting state exposed as text, so that the feature does not depend on visual treatment alone.
59. As a Carrent developer, I want Thread Actions selected from a Carrent-owned allowlist, so that Runtime-advertised commands are not exposed without product support.
60. As a Carrent developer, I want Runtime-specific compaction normalized behind a shared Thread Action contract, so that future Runtime adapters can implement Compact without leaking protocol details into the Renderer.
61. As a Carrent developer, I want Compact capability detected from the active Runtime Session, so that installed Runtime versions remain the source of truth for actual support.
62. As a Carrent developer, I want Kimi Compact executed through ACP against the existing Runtime Session, so that continuity and ADR-0002 remain intact.
63. As a Carrent developer, I want the Kimi adapter to send a bare `/compact`, so that Carrent never forwards optional custom summarization instructions.
64. As a Carrent developer, I want Runtime output produced by the Compact command suppressed from normal Agent messages, so that only the Carrent-owned divider represents success.
65. As a Carrent maintainer, I want user-visible behavior tested at the existing Renderer integration boundary, so that UI refactors preserve eligibility and lifecycle semantics.
66. As a Carrent maintainer, I want ACP execution tested through the existing Chat Session Manager boundary, so that protocol or Session regressions are caught without testing private helpers.
67. As a Carrent maintainer, I want Compact history round-tripped through Workspace Persistence, so that restart behavior is an explicit contract.

## Implementation Decisions

- The canonical domain concept is Thread Action. `Compact` is a Thread Action, not a Run, Tool Activity, Skill, Runtime mode, user message, or Agent message.
- The slash menu remains the only Compact entry point in this delivery. No persistent toolbar button is added.
- The menu has no visible Thread Actions heading. Its order is `Plan mode`, `Compact`, then the existing `Skills` group.
- Compact and Plan Mode entries remain text-only and use no leading icons.
- Slash-menu matching includes Compact for leading command queries such as `/`, `/c`, and `/co`. Existing keyboard selection and dismissal behavior is reused.
- A leading `/compact` command with a complete word boundary is intercepted as a Thread Action. The command token is removed, any following text is retained as unsent draft content, and attachments remain attached. The trailing text is never passed to the Runtime as Compact input.
- Selecting the menu item and submitting a leading `/compact` share one execution path. Neither path creates a Run or enters the queued-message flow.
- A Carrent-owned Runtime-neutral Thread Action capability contract controls menu exposure. The first supported action is `compact`; unknown Runtime commands are ignored even when advertised.
- Runtime adapters explicitly map the shared Compact action to native behavior. The first implementation supports Kimi only and uses Kimi ACP over stdio.
- Kimi capability discovery observes the active Runtime Session's advertised commands and requires an exact `compact` capability. Carrent does not assume support solely from Runtime identity or version strings.
- Compact visibility requires all of the following: the selected Thread is idle; no Compact is active for that Thread; the current Runtime advertises Compact; a resumable Runtime Session exists; and the current Runtime has at least one complete exchange after its latest successful Compact.
- A complete exchange is a completed Run with both a persisted user request and an effective persisted Agent reply. A completed Plan Review is effective. Drafts, queued messages, errors, Run Checklists, failed or cancelled Runs without an effective reply, and Thread Action history are not complete exchanges.
- Context usage percentage does not gate availability. When Compact is available, its description includes the current Runtime-reported percentage using copy equivalent to `Compress this thread's context (34% used)`.
- If capability or Runtime Session status cannot be established, Compact remains absent rather than appearing disabled or speculative.
- Manually submitting `/compact` while any visibility precondition is false does not create a Run or Runtime prompt. Carrent removes the command token, preserves trailing draft content and attachments, and displays a concise reason-specific error.
- Compact uses a dedicated preload/IPC operation rather than the normal chat-send operation. Its request identifies the owning Thread, selected Runtime, Project Working Directory, and any correlation data needed to bind the result to the initiating Thread.
- The Electron chat layer resolves the existing Runtime Session mapping and never creates a new Session solely to perform Compact. Missing mappings return an unavailable result.
- The Kimi adapter initializes ACP, resumes the mapped Session, verifies the advertised Compact command, and sends one `session/prompt` containing only `/compact`.
- A normal ACP response confirms success. ACP errors, process errors, resume rejection, and timeout confirm failure. Agent message chunks or other display output produced by the command do not become conversation messages.
- Compact has a five-minute Carrent timeout. Timeout terminates the operation transport and follows the ordinary Compact failure path.
- Compact has no user cancellation path. No cancel button, stop control, or `session/cancel` request is exposed for this action.
- Compacting is Runtime-neutral per-Thread transient state, distinct from live Run state. It is not persisted across application restart.
- While the selected Thread is compacting, the Composer remains editable, sending is disabled, and Thread Actions are unavailable. The affected Thread displays `Compacting` in navigation and in the selected Thread surface.
- Compacting one Thread does not block navigation or work in other Threads. Completion and failure are routed back to the owning Thread even when it is not selected.
- Application shutdown terminates in-flight Compact work under the normal process lifecycle. Restart restores the Thread as idle, does not resume Compact, and does not infer or append success.
- Explicit invalid-session or resume-rejection failures remove only the affected Runtime + Thread Session mapping. The next normal Run may establish a fresh Session using Carrent's persisted transcript. Other failure types do not remove the mapping.
- Success atomically appends a dedicated Carrent-owned Thread Action timeline event and updates Thread Activity Time. The event records stable identity, owning Thread, action kind, Runtime provenance, and completion time, but renders only the agreed generic label.
- The timeline event is distinct from user and assistant Message records. It is excluded from Runtime transcripts, Run reconstruction, complete-exchange detection, Agent Activity, search text intended for conversation content, and message editing.
- The successful timeline presentation is a horizontal divider with centered `Context compacted` copy. It has no avatar, message bubble, icon, visible timestamp, Runtime output, or success Toast.
- After success, context usage is refreshed. Compact remains unavailable for that Runtime until a later completed Run adds a new complete exchange after the Compact event.
- Multiple successful Compact events are preserved when each is followed by a new complete exchange before the next Compact.
- Failure and timeout append no event, do not update Thread Activity Time, do not retry, preserve the Composer draft and attachments, restore sending, and show a concise error.
- Persisted Compact events are normalized and bounded with the same defensive posture as other Thread history. Invalid records are rejected without corrupting valid conversation history.
- Thread Activity Time semantics expand to include successful persistent Thread Actions. Failed, timed-out, or merely started Compact operations do not update it.
- Thread Status semantics expand with `Compacting`, a transient state outside a Run. It does not reuse the internal `running` state and cannot activate Run-only stop, approval, question, queue, Checklist, or file-change behavior.
- Plan Mode selection, Runtime permission mode, Runtime model selection, queued-message behavior, and attachment semantics remain unchanged by Compact.
- These decisions follow ADR-0002 by retaining ACP as the Kimi integration boundary. No new ADR is required because the Thread Action catalog and UI lifecycle are locally reversible product decisions.

## Testing Decisions

- Good tests assert user-visible availability, execution, state, history, persistence, and protocol effects. They do not assert React state names, internal map layout, CSS class strings, helper call order, or arbitrary implementation decomposition.
- The primary Renderer seam is the existing App/Composer integration boundary with the preload bridge faked at its public API. Tests interact with the slash menu and observe the rendered Thread, Composer, navigation state, saved App State Snapshot, and calls made through the public bridge.
- Renderer tests cover menu order, lack of heading and icons, query filtering, keyboard selection, direct leading-command submission, command-token removal, trailing draft and attachment preservation, and absence from the queued-message flow.
- Renderer tests cover every visibility condition: no complete exchange, completed exchange, completed Plan Review, incomplete or failed exchange, missing Runtime Session, unsupported capability, current live Run, active Compact, success with no later exchange, and a later completed exchange.
- Renderer tests verify that context percentage is informational only and that values below any arbitrary threshold still allow Compact.
- Renderer tests cover compacting behavior: editable Composer, disabled sending, hidden Compact action, `Compacting` navigation state, Thread switching, continued use of another Thread, and result routing to the owning Thread.
- Renderer tests cover success: no Run creation, no user or Agent message, one `Context compacted` divider, no success Toast, refreshed usage, updated Thread Activity Time, and Compact hidden until a later complete exchange.
- Renderer tests cover failure, timeout, and manual submission while unavailable: no divider, no activity-time update, no retry, preserved draft and attachments, restored sending, and concise error feedback.
- Renderer tests cover repeated valid Compact cycles and ensure each successful cycle retains one correctly ordered divider.
- The Runtime seam is the existing Chat Session Manager with a fake ACP transport and real public Session Manager methods. This is the highest existing boundary that can verify both Runtime Session ownership and emitted ACP traffic.
- Runtime tests cover resolving the correct Runtime + Thread Session mapping, initializing and resuming that Session, observing advertised commands, sending exactly one bare `/compact`, suppressing command output, and returning success without Run lifecycle events.
- Runtime tests cover missing Session, absent advertised capability, resume rejection, ACP error, process error, and five-minute timeout. Fake timers verify the timeout without waiting in real time.
- Runtime tests verify explicit invalid-session cleanup affects only the owning Runtime + Thread mapping and leaves unrelated mappings intact.
- Runtime tests verify there is no cancellation request or public cancellation path for Compact.
- The persistence seam is the existing Workspace Persistence normalization and round-trip boundary.
- Persistence tests round-trip valid Compact events, Runtime provenance, ordering among conversation records, and updated Thread Activity Time across restart.
- Persistence tests reject malformed, unknown, oversized, or cross-Thread Compact events without discarding valid Thread conversation data.
- Persistence tests verify in-flight compacting state is not persisted and restart does not synthesize a success event.
- Existing prior art includes Renderer tests for slash-menu Plan Mode and Skills, App-level Chat Run coordination and navigation, Chat Session Manager tests with fake Kimi ACP transports, and Workspace Persistence tests for structured Thread data.
- No lower-level helper tests are required unless behavior cannot be expressed through one of the three agreed boundaries.

## Out of Scope

- Thread Rewind behavior for Compact events.
- Exposing Compact for Codex, Claude Code, Pi, or another non-Kimi Runtime in the first delivery.
- Automatically exposing every Runtime-advertised command.
- Adding other Thread Actions beyond Compact.
- Adding a visible Thread Actions group heading.
- Adding icons to Plan Mode or Compact entries.
- Adding a persistent toolbar button, context-menu entry, command palette entry, or settings control for Compact.
- Automatically compacting based on context percentage, token count, time, Run count, or provider warning.
- Imposing a minimum context-usage threshold.
- Accepting or forwarding custom summarization instructions.
- Displaying the Runtime's generated compaction summary or raw command output.
- Treating Compact as a Run, user message, Agent message, Agent Activity item, Tool Activity item, or Skill.
- Creating a new Runtime Session solely to make Compact available.
- User cancellation, automatic retry, or resuming an interrupted Compact after restart.
- A success Toast, desktop notification, sound, badge, or visible timestamp on the divider.
- Changing Plan Mode, Plan Review, Runtime permission modes, model selection, approvals, questions, Subagent Tasks, Run Checklists, attachments, file changes, or queued-message behavior beyond the explicit Compact gating rules.
- Reconstructing missing Compact events by inspecting Runtime Session contents after a crash or application shutdown.

## Further Notes

- `Thread Action` is the canonical internal term. The agreed Chinese product term for the conceptual area is `会话操作`, but this delivery does not render that group label in the slash menu.
- The existing glossary currently defines Thread Activity Time and Thread Status only around Run events. Implementation must update those definitions to include successful Thread Actions and the transient `Compacting` state.
- Kimi ACP observations already show `available_commands_update` advertising `compact` with optional input. Carrent intentionally uses capability presence but does not expose or forward the optional input.
- Compact history is Carrent-owned evidence that Carrent received a successful Runtime response. It is not proof reconstructed from later context size, and uncertain outcomes intentionally produce no divider.
- The five-minute timeout is the only escape from an unresponsive Compact operation during normal app use; users cannot cancel it manually.
