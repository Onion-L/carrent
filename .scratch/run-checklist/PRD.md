# Run Checklist PRD

Status: done

## Problem Statement

Carrent shows Agent Activity as a chronological trail of reasoning and tool use, but it does not show the mutable work checklist a Coding Agent uses to communicate implementation progress. A user can see individual commands and file operations without being able to tell which intended step is active, which steps are complete, or how much work remains.

Kimi Code 0.29.1 already maintains this information through its TodoList tool and exposes populated snapshots over ACP as `plan` session updates. Carrent currently ignores those updates. The user therefore receives less progress information in Carrent than in Kimi's own TUI even though the existing Runtime transport already carries the required structure.

## Solution

Carrent adds a read-only Run Checklist surface above the Composer. A compact progress button shows the current position, such as `Step 2 of 4`, and toggles a fixed-height checklist panel. The panel shows every item in Runtime order with distinct pending, in-progress, and completed states; overflow scrolls inside the panel.

The Checklist is current Thread state rather than Message Timeline history. It updates from structured Runtime snapshots, remains available when its Run completes, fails, or is cancelled, survives Thread navigation and application restart, and is cleared when the same Thread's next Run begins. The shared contract is Runtime-neutral, while the first producer is Kimi's ACP `plan` update.

## User Stories

1. As a Carrent user, I want to see the Coding Agent's Run Checklist, so that I understand the implementation path without reading every activity item.
2. As a Carrent user, I want the Checklist visible above the Composer, so that progress remains in view while I scroll the Thread.
3. As a Carrent user, I want a compact progress button, so that the Checklist does not permanently consume vertical space.
4. As a Carrent user, I want the progress button to show the current step and total steps, so that I can estimate where the Run is in its intended work.
5. As a Carrent user, I want to click the progress button to expand or collapse the Checklist, so that I control how much detail is visible.
6. As a Carrent user, I want the Checklist to open automatically when it first appears in a Run, so that I notice that structured progress is available.
7. As a Carrent user, I want my manual expanded or collapsed choice respected after the initial appearance, so that Runtime updates do not fight my UI choice.
8. As a Carrent user, I want every Checklist item displayed in Runtime order, so that Carrent does not hide or reorder intended work.
9. As a Carrent user, I want long Checklists to use a fixed-height scrolling panel, so that all items remain available without covering the conversation.
10. As a Carrent user, I want pending items visually distinct from active and completed items, so that I can scan progress quickly.
11. As a Carrent user, I want the active item to be visually prominent, so that I know what the Coding Agent is working on now.
12. As a Carrent user, I want completed items clearly marked, so that finished work is distinguishable from remaining work.
13. As a Carrent user, I want the current position to use the active item's list position, so that `Step 2 of 4` refers to the second item being in progress.
14. As a Carrent user, I want a not-yet-started Checklist to show zero progress, so that pending work is not presented as active.
15. As a Carrent user, I want a fully completed Checklist to show the total as complete, so that the final progress summary is unambiguous.
16. As a Carrent user, I want Runtime updates to replace the Checklist as a whole, so that revised steps and ordering match the Coding Agent's latest intent.
17. As a Carrent user, I want removed Runtime items to disappear from the current Checklist, so that obsolete work is not presented as remaining work.
18. As a Carrent user, I want the Checklist to remain after a successful Run, so that I can inspect the final state before sending another request.
19. As a Carrent user, I want the last Checklist snapshot to remain after a failed Run, so that I can see where work stopped.
20. As a Carrent user, I want the last Checklist snapshot to remain after a cancelled Run, so that stopping work does not erase its last known state.
21. As a Carrent user, I want Carrent to preserve unfinished item states when a Run ends, so that it does not invent progress the Runtime never reported.
22. As a Carrent user, I want a failed or cancelled Run marked at the panel level, so that item progress and overall outcome are not conflated.
23. As a Carrent user, I want the Checklist to remain while I draft the next message, so that typing does not prematurely erase useful context.
24. As a Carrent user, I want the old Checklist cleared when my next Run begins, so that stale steps are not associated with new work.
25. As a Carrent user, I want a new Checklist to appear only when the new Run emits one, so that Carrent does not reuse old progress.
26. As a Carrent user, I want each Thread to retain its own Checklist, so that switching Threads cannot show another Run's progress.
27. As a Carrent user, I want a Checklist restored when I navigate back to its Thread, so that navigation does not lose current progress.
28. As a Carrent user, I want retained Checklists restored after restarting Carrent, so that application lifecycle does not erase the latest visible state.
29. As a Carrent user, I want the Checklist available in any Run mode that emits structured progress, so that Plan Mode and future modes do not require separate UI.
30. As a Carrent user, I want no Checklist when a Runtime does not provide structured progress, so that inferred or fabricated steps are never shown.
31. As a Carrent user, I want TodoList updates omitted from Thinking once represented by the Checklist, so that the same action is not shown twice.
32. As a Carrent user, I want all other Agent Activity preserved, so that adding the Checklist does not hide reasoning, shell commands, file activity, or other tool use.
33. As a Carrent user, I want the Checklist to remain read-only, so that Carrent cannot diverge from Runtime-owned progress.
34. As a keyboard user, I want the progress button to expose and control its expanded state, so that I can operate the Checklist without a pointer.
35. As a screen-reader user, I want item and Run states communicated as text as well as icons, so that progress does not depend on color or shape alone.
36. As a Carrent developer, I want the shared Checklist contract to be Runtime-neutral, so that future Runtime adapters can reuse the same state and UI.
37. As a Carrent developer, I want Kimi ACP `plan` updates normalized into the shared contract, so that the Renderer does not depend on raw ACP payloads.
38. As a Carrent developer, I want only structured Runtime updates accepted, so that reasoning text and final answers are not parsed heuristically.
39. As a Carrent developer, I want Checklist snapshots bound to their originating Run and Thread, so that late events cannot overwrite another Run's state.
40. As a Carrent developer, I want malformed snapshots rejected atomically, so that partial validation cannot present a misleading plan.
41. As a Carrent developer, I want persisted Checklist data normalized and bounded, so that invalid or excessive Runtime data cannot corrupt workspace restoration.
42. As a Carrent maintainer, I want behavior tested through the existing Run event and Composer boundary, so that refactors do not change user-visible lifecycle rules.
43. As a Carrent maintainer, I want one narrow ACP mapping test, so that protocol shape changes are caught without duplicating Renderer behavior tests.
44. As a Carrent maintainer, I want persistence tests to round-trip the current Thread Checklist, so that restart behavior is an explicit contract.

## Implementation Decisions

- Carrent continues to drive Kimi through ACP over stdio. No KAP integration or CLI text parsing is needed for this feature.
- The shared chat protocol gains a Runtime-neutral Run Checklist snapshot event. The event is correlated with the existing Run identity and request identity.
- A Checklist snapshot is an ordered full replacement. Each entry contains display content and one of `pending`, `in_progress`, or `completed`; entries have no Carrent-generated stable identity.
- ACP `plan.entries[].content` becomes Checklist item content. ACP statuses map directly to the three shared states. ACP priority is not displayed or used for ordering in this delivery.
- The Kimi adapter handles `session/update` notifications whose discriminator is `plan`. It preserves entry order and emits one normalized snapshot.
- The first delivery does not infer a Checklist from TodoList raw input, Tool Activity, reasoning, assistant text, Plan Review content, or final answers.
- Kimi TodoList Tool Activity is omitted from Thinking when it belongs to the dedicated Run Checklist surface. Other Tool Activity remains unchanged.
- Unknown or malformed entry states, missing content, non-array entries, and oversized snapshots cause the complete snapshot to be ignored. Carrent does not partially display a malformed full replacement.
- A structured empty snapshot clears the current Checklist. Kimi 0.29.1 does not currently emit an empty `plan`, so the guaranteed Kimi clear boundary remains the next Run starting.
- Checklist state belongs to a Thread, not an Assistant Message. It is not added to Message Timeline parts and does not become permanent conversation history.
- Persisted Thread state gains an optional latest Checklist containing its owning Run, Runtime, ordered entries, overall Run state, and expanded state.
- Project Threads and project-less Threads use the same Checklist semantics and persistence validation.
- A `started` event for a Thread clears its retained Checklist before any snapshot from the new Run is applied. Drafting or editing Composer input does not clear it.
- A snapshot is accepted only for the currently owning Run. Late snapshots from an older or terminally replaced Run cannot recreate a cleared Checklist.
- `completed`, `failed`, and `stopped` Run events retain the final snapshot and set the panel-level outcome to completed, failed, or cancelled respectively.
- Carrent never upgrades pending or in-progress items when a Run ends. A successful Run may therefore retain incomplete items when that is the Runtime's last report.
- Thread navigation reads Checklist state from the selected Thread. Switching Threads neither clears nor shares Checklist state.
- Workspace persistence restores the latest valid Checklist and its expanded state after application restart. A Runtime Session resumed without a Carrent-persisted Checklist does not reconstruct one because Kimi ACP session loading does not replay `plan` updates.
- The UI is a dedicated surface immediately above the Composer and independent of Agent Activity, Plan Review, Approval Requests, questions, and Subagent Tasks.
- A compact progress button remains visible whenever the selected Thread has a Checklist and toggles the panel with an explicit expanded state.
- The first accepted snapshot of a new Run expands the panel automatically. Later snapshots do not change the user's expanded or collapsed choice. Terminal Run events also preserve that choice.
- The panel renders every entry. It uses a fixed responsive maximum height and internal scrolling rather than selecting or hiding overflow items.
- Completed items use a completed icon and treatment, in-progress items use an active treatment, and pending items use a neutral treatment. State is also available in accessible text.
- The progress numerator is the one-based position of the first in-progress item. With no in-progress item, it is the completed count; a wholly pending list therefore shows zero and a wholly completed list shows the total.
- If malformed Runtime behavior produces multiple in-progress entries, all are rendered as active and the first determines the progress numerator.
- The Checklist is read-only. The only user action is expanding or collapsing it; items cannot be checked, renamed, deleted, or reordered.
- The surface is available in every Runtime mode. Display depends only on a valid structured snapshot, not on Plan Mode or another posture flag.
- The UI follows the existing Carrent language and visual tokens. It uses familiar status and disclosure icons, aligns with the Composer width, and avoids introducing a nested card hierarchy.
- The Run Checklist is a narrow dedicated progress surface. Omitting Kimi's TodoList call from Thinking is a deliberate exception to the general Agent Activity presentation in ADR-0008; no other Agent Activity behavior changes.
- The feature aligns with ADR-0002 by using ACP as the integration boundary and does not require a new architectural transport decision.

## Testing Decisions

- Good tests assert visible Checklist behavior, normalized protocol output, and persisted Thread state. They do not assert private React state, internal map layout, CSS implementation details, or helper call order.
- The primary test seam is the existing Renderer Run coordination and Composer behavior boundary. Tests feed public shared Run events for a selected Thread and observe the rendered progress control and Checklist panel.
- Primary seam tests cover first-snapshot auto-expansion, manual collapse and expansion, status rendering, progress calculation, full-list rendering, and fixed-height overflow behavior.
- Primary seam tests cover full replacement when items are added, removed, renamed, reordered, or change status.
- Primary seam tests cover successful, failed, and cancelled Run outcomes retaining the last item states and displaying the overall outcome.
- Primary seam tests cover Composer typing preserving the Checklist and the next `started` event clearing it.
- Primary seam tests cover a new Run with no Checklist update leaving the surface absent.
- Primary seam tests cover Thread switching, independent Checklists in two Threads, and returning to the originating Thread.
- Primary seam tests cover late updates from the previous Run being ignored after the next Run starts.
- Primary seam tests cover read-only behavior, keyboard disclosure, `aria-expanded`, status text, and non-color state cues.
- The main Renderer prior art is the structured question panel behavior test, the Chat Run event coordinator test, and Workspace state transition tests.
- One narrow Kimi ACP adapter seam feeds real-shaped `plan` session updates through the fake ACP transport and asserts one Runtime-neutral Checklist snapshot with preserved order and mapped states.
- The ACP seam also verifies that valid snapshots work in ordinary and Plan Mode Runs, malformed snapshots do not fail the Run, and TodoList does not create duplicate Thinking activity.
- Workspace persistence tests round-trip valid Checklists for both Thread kinds, preserve expanded and terminal states, and reject malformed or over-limit snapshots atomically.
- Persistence prior art is the existing normalization coverage for Plan Review, structured questions, Subagent Tasks, attachments, and Thread mode fields.
- Message Timeline tests are not added for Checklist content because the Checklist is intentionally Thread state outside Assistant Message history.

## Out of Scope

- Parsing reasoning, final answers, plan documents, or generic tool output to construct a Checklist.
- Switching Kimi integration from ACP to KAP or another transport.
- Modifying Kimi Code's upstream ACP adapter.
- Replaying a Checklist from Runtime Session history when Carrent never observed or persisted it.
- Keeping prior Checklist revisions or showing a historical Checklist inside old Assistant Messages.
- Manual item completion, editing, deletion, creation, drag-and-drop ordering, or Runtime write-back.
- Step dependencies, nested steps, priorities, owners, estimates, timestamps, duration per item, or percentage calculations.
- Filtering or summarizing long Checklists by hiding items.
- Inferring completion from a successful Run or inferring failure for unfinished items.
- Adding structured Checklist producers to non-Kimi Runtime adapters in the first delivery.
- Changing Plan Mode, Plan Review, Agent Activity, Subagent Task, Approval Request, or structured-question workflows beyond avoiding the duplicate TodoList activity.
- OS notifications, badges in the Thread list, or background workflow orchestration based on Checklist state.

## Further Notes

- The canonical product term is Run Checklist. `Todo list`, `ACP Plan`, `Plan Review`, and `Agent Activity` refer to different concepts and should not be used as UI or domain synonyms.
- Kimi Code 0.29.1 maps a populated TodoList display block to ACP `sessionUpdate: "plan"` with full replacement semantics. Kimi `done` becomes ACP `completed`, and Kimi currently assigns medium priority to every entry.
- Kimi's current ACP adapter does not emit an empty Plan when the TodoList clears and does not recreate Plan updates during `session/load`. Carrent's next-Run clear rule and persisted observed state are intentional product behavior around those limitations; they do not claim the missing Runtime events exist.
- No new ADR is required for the current decisions: the feature follows the existing ACP boundary, and its placement and lifecycle remain locally reversible product choices.
