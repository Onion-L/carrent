# Runtime Session Status PRD

Status: ready-for-agent

## Problem Statement

Carrent already queries Kimi Code for Context usage so it can render the existing Composer usage indicator and decide whether Compact is available. However, users cannot deliberately inspect the current Runtime Session from Carrent. They must leave Carrent or use a Runtime-owned interface to find the Session ID, exact Context consumption, and remaining capacity.

Sending `/status` as an ordinary prompt would be misleading and potentially costly: it could create conversation history, start a Run, consume quota, or expose raw Runtime-formatted output that does not match Carrent's interface. Carrent also cannot assume that every Runtime or installed Runtime version supports the command.

Kimi Code's TUI may additionally show Coding Plan quota windows such as Weekly and 5h usage. Real Kimi Code 0.29.1 ACP observations show that `available_commands_update` advertises `status`, but ACP `/status` currently returns only model posture and Context usage, while ACP `/usage` returns token totals and Context usage. Neither command currently returns Weekly, 5h, or reset data. Carrent must therefore support optional quota data without fabricating it or depending on Kimi's private account APIs.

## Solution

Carrent adds a Carrent-owned `/status` command to the existing Composer slash menu. It is shown only for a Thread with an existing Runtime Session whose active Runtime explicitly advertises the exact `status` command, and only while the Thread is not running, compacting, or already loading status.

Submitting `/status` invokes the Runtime command against the existing Runtime Session without creating a Run or adding messages. Carrent parses the result into a normalized Session Status snapshot and renders its own non-modal panel above the Composer. The panel contains the complete Session ID and Context usage formatted as remaining percentage, exact used tokens, and compact total capacity. If the Runtime actually reports Weekly or 5h quota data, Carrent also shows those values and their reported reset information; absent data produces no section or placeholder.

The existing Context usage indicator remains unchanged and is not an entry point for the panel. Status is fetched on every `/status` execution, never polled, never persisted, and cleared when the selected Thread, Runtime, or Project changes. Failures do not open an empty panel or create conversation history.

## User Stories

1. As a Carrent user, I want `/status` available in the Composer slash menu, so that I can inspect the current Runtime Session without leaving Carrent.
2. As a Carrent user, I want Status presented as a Carrent-owned interface, so that it is visually consistent with the rest of the desktop app.
3. As a Carrent user, I want raw Runtime status text excluded from Message Timeline, so that a diagnostic command is not presented as conversation.
4. As a Carrent user, I want `/status` to create no Run, so that inspecting status does not look like coding work.
5. As a Carrent user, I want `/status` to create no user or Agent message, so that Thread history remains truthful.
6. As a Carrent user, I want `/status` to avoid model invocation, so that checking status does not consume ordinary model quota.
7. As a Carrent user, I want Status shown only when the selected Runtime explicitly supports it, so that Carrent does not expose commands optimistically.
8. As a Carrent user, I want Status hidden when the installed Runtime version does not advertise `status`, so that unsupported versions remain understandable.
9. As a Carrent user, I want Status hidden when the Thread has no Runtime Session, so that Carrent does not offer information it cannot retrieve.
10. As a Carrent user, I want Carrent not to create a Runtime Session merely to detect Status support, so that an empty Thread remains empty.
11. As a Carrent user, I want Status hidden while a Run is active, so that two operations cannot concurrently use the same Runtime Session.
12. As a Carrent user, I want Status hidden while Compact is active, so that inspection cannot race with Context mutation.
13. As a Carrent user, I want Compact unavailable while Status is loading, so that the Runtime Session has only one active control operation.
14. As a Carrent user, I want sending disabled while Status is loading, so that a new Run cannot race with the status request.
15. As a Carrent user, I want duplicate Status requests blocked while one is loading, so that repeated input cannot start concurrent requests.
16. As a Carrent user, I want ordinary sending restored immediately after Status succeeds or fails, so that the diagnostic request does not leave the Thread blocked.
17. As a Carrent user, I want manually entered `/status` rejected when unavailable, so that it is never forwarded to the Coding Agent as an ordinary prompt.
18. As a Carrent user, I want an unsupported manual command to show `Status is unavailable for this runtime.`, so that the reason is clear.
19. As a Carrent user, I want typing `/st` to discover Status through the existing slash-menu filtering, so that keyboard discovery matches Compact.
20. As a keyboard user, I want Status selectable through the existing slash-menu navigation, so that no pointer is required.
21. As a Carrent user, I want selecting the Status menu item to execute immediately, so that no second confirmation is required.
22. As a Carrent user, I want submitting a leading `/status` to use the same execution path as the menu item, so that the command is predictable.
23. As a Carrent user, I want `/status` removed from the Composer after execution, so that control text does not remain in my draft.
24. As a Carrent user, I want text after a leading `/status` preserved as an unsent draft, so that checking status does not discard what I was preparing.
25. As a Carrent user, I want pending attachments preserved when I invoke Status, so that inspection does not alter my next request.
26. As a Carrent user, I want the complete Runtime Session ID displayed, so that I can identify the exact continuity handle in diagnostics.
27. As a Carrent user, I want the Session ID selectable as text, so that I can copy it using normal text selection when needed.
28. As a Carrent user, I want no dedicated copy button in the Status panel, so that the panel remains focused on inspection while Thread context menus may offer copy actions.
29. As a Carrent user, I want Context remaining capacity displayed first, so that the most actionable value is easy to scan.
30. As a Carrent user, I want remaining Context percentage derived from the Runtime-reported used percentage, so that Carrent can present the requested perspective without inventing source data.
31. As a Carrent user, I want remaining Context percentage shown with at most one decimal place, so that values such as `96.6%` retain useful precision without showing `.0` unnecessarily.
32. As a Carrent user, I want exact used Context tokens displayed with grouping separators, so that large values remain readable.
33. As a Carrent user, I want total Context capacity displayed in compact notation such as `258K` or `1M`, so that the status line stays concise.
34. As a Carrent user, I want Context formatted like `Remaining 96.6% (35,193 used / 1M total)`, so that remaining and consumed capacity are visible together.
35. As a Carrent user, I want the existing Context usage circle retained, so that passive usage awareness remains available.
36. As a Carrent user, I want the Context usage circle to keep its existing hover behavior, so that this feature does not replace a working summary.
37. As a Carrent user, I want clicking the Context usage circle to do nothing new, so that `/status` remains the deliberate panel entry point.
38. As a Carrent user with Coding Plan quota data, I want Weekly usage displayed when the Runtime actually returns it, so that account limits are visible in the same panel.
39. As a Carrent user with Coding Plan quota data, I want 5h usage displayed when the Runtime actually returns it, so that the shorter limit window is visible.
40. As a Carrent user, I want each quota window to show used and remaining percentages when a used percentage is reported, so that consumption and headroom are both clear.
41. As a Carrent user, I want a quota reset duration displayed only when the Runtime reports it, so that Carrent never guesses reset timing.
42. As a Carrent user, I want Weekly shown without 5h when only Weekly is returned, so that partial valid data remains useful.
43. As a Carrent user, I want 5h shown without Weekly when only 5h is returned, so that one absent window does not hide another valid window.
44. As a Carrent user, I want the entire Plan usage section omitted when no quota data is returned, so that the panel has no misleading empty state.
45. As a Carrent user, I want malformed quota values omitted independently, so that one invalid field does not fabricate or corrupt another valid field.
46. As a Carrent user, I want Carrent to avoid reading Kimi credentials for this panel, so that a read-only status feature does not expand credential access.
47. As a Carrent user, I want Carrent to avoid Kimi's private account endpoints, so that the feature does not depend on undocumented APIs.
48. As a Carrent user, I want Status fetched each time I execute `/status`, so that the displayed snapshot reflects the latest Runtime response.
49. As a Carrent user, I want an already open panel updated by a later successful `/status`, so that I can refresh it deliberately.
50. As a Carrent user, I want no automatic polling, so that Carrent does not repeatedly resume the Runtime Session in the background.
51. As a Carrent user, I want the panel to remain stable after loading, so that values do not change while I read them.
52. As a Carrent user, I want a refresh failure to report an error without replacing valid existing panel data, so that a transient failure does not erase the last explicitly loaded snapshot.
53. As a Carrent user, I want an initial load failure not to open an empty panel, so that absence is not mistaken for a zero value.
54. As a Carrent user, I want a concise `Unable to load session status.` error near the Composer, so that failure is visible without entering history.
55. As a Carrent user, I want my draft and attachments preserved after Status failure, so that diagnostics cannot destroy unsent work.
56. As a Carrent user, I want no automatic retry after Status failure, so that Carrent does not repeat a Runtime operation without consent.
57. As a Carrent user, I want the Status panel above the Composer, so that it remains associated with the selected Thread controls.
58. As a Carrent user, I want the Status panel non-modal, so that I can continue reading and scrolling the Thread.
59. As a Carrent user, I want no page backdrop or blocked Message Timeline interaction, so that the panel does not interrupt inspection of the conversation.
60. As a Carrent user, I want the panel to use the existing Carrent visual tokens, so that it does not look like embedded Runtime output.
61. As a Carrent user, I want English labels matching the current Carrent interface, so that the panel uses consistent product language.
62. As a Carrent user, I want the labels `Status`, `Session`, `Context`, `Plan usage`, `Weekly`, `5h`, and `Close`, so that the information is plainly named.
63. As a Carrent user, I want to close the panel with its Close control, so that dismissal is explicit.
64. As a keyboard user, I want to close the panel with Escape, so that dismissal does not require a pointer.
65. As a Carrent user, I want sending a new message to close the panel, so that stale diagnostic information does not remain beside a new Run.
66. As a Carrent user, I want switching Thread to close and clear the panel, so that another Thread never shows the previous Runtime Session.
67. As a Carrent user, I want switching Runtime to close and clear the panel, so that status provenance remains correct.
68. As a Carrent user, I want switching Project to close and clear the panel, so that Session data cannot cross Project context.
69. As a Carrent user, I want Status data to remain transient, so that application restart does not restore an old snapshot as current information.
70. As a screen-reader user, I want the panel title, field labels, loading state, errors, and Close control exposed as text, so that the feature does not depend on layout alone.
71. As a screen-reader user, I want loading controls to expose a busy state, so that temporarily unavailable sending and commands have an understandable cause.
72. As a Carrent developer, I want capability determined from exact Runtime-advertised command names, so that Runtime identity and version strings are not treated as proof of support.
73. As a Carrent developer, I want unknown Runtime commands ignored, so that Carrent exposes only product-supported commands.
74. As a Carrent developer, I want Session Status normalized before it reaches the Renderer, so that ACP text shape does not leak into UI components.
75. As a Carrent developer, I want Session ID sourced from Carrent's Runtime Session mapping, so that the panel does not depend on the Runtime echoing it in display text.
76. As a Carrent developer, I want `/status` executed over ACP against the existing Runtime Session, so that the feature follows Carrent's established Runtime boundary.
77. As a Carrent developer, I want the current Kimi `0.29.1` ACP behavior captured in tests, so that future output changes are detected deliberately.
78. As a Carrent developer, I want optional quota parsing isolated from required Session and Context data, so that future ACP additions can appear without weakening current validation.
79. As a Carrent maintainer, I want visible behavior tested through the mounted Composer boundary, so that UI refactors preserve command and panel semantics.
80. As a Carrent maintainer, I want ACP parsing tested with real-shaped protocol messages, so that Runtime format regressions are caught without launching the full app.
81. As a Carrent maintainer, I want Runtime Session resolution tested through the Chat Session Manager boundary, so that Session creation and provenance rules remain explicit.

## Implementation Decisions

- Session Status is a Carrent-owned read-only inspection command. It is not a Run, Message, Agent Activity item, Tool Activity item, Skill, Plan Mode, or context-mutating Thread Action.
- The Composer slash menu is the only new entry point. The existing Context usage indicator remains unchanged and does not open the panel on click.
- Status appears with the existing Carrent-owned commands after Compact and before Skills. It uses the existing text-only command presentation and slash-menu keyboard behavior.
- Slash-menu matching recognizes leading Status queries such as `/`, `/s`, and `/st` using the existing command filtering rules.
- A leading `/status` with a complete word boundary is intercepted locally. Carrent removes the command token, retains following text as unsent draft content, and preserves pending attachments.
- Selecting Status from the slash menu and submitting a leading `/status` share one execution path. Neither path creates a Run, enters the queued-message flow, or sends trailing draft text to the Runtime.
- A manually submitted `/status` is always intercepted. When unavailable, it produces `Status is unavailable for this runtime.` and is never forwarded as an ordinary prompt.
- Availability requires an existing Runtime Session mapping, exact `status` capability from the active Runtime Session's `available_commands_update`, an idle Thread, no active Compact operation, and no active Status request.
- Carrent does not create or resume a new Runtime Session solely to discover Status capability. If support or Session continuity cannot be established, Status is absent from the menu.
- Status capability is selected through a Carrent-owned allowlist. Unknown Runtime-advertised commands remain hidden.
- The first adapter is Kimi ACP. The shared result is normalized so another Runtime can provide the same panel later without exposing protocol-specific output to the Renderer.
- Status uses a dedicated non-Run chat operation. Its request is bound to the selected Thread, Runtime, Runtime model/mode context needed to resolve the existing Session, and Project Working Directory.
- The Electron chat layer resolves the current Runtime Session mapping and includes the complete Session ID in the normalized result. Missing mappings return no status and never create a Session.
- The Kimi adapter initializes ACP, resumes the mapped Session, verifies that `status` is advertised, and sends one `session/prompt` containing only `/status`.
- Runtime-produced status text is captured for parsing and suppressed from normal Agent messages. A normal prompt response confirms completion; transport, resume, protocol, and parsing failures follow the Status failure path.
- The normalized Session Status contract contains the Session ID, Context used tokens, Context total tokens, Runtime-reported used percentage, advertised Carrent-supported commands, and optional quota windows.
- Context remains required for a successful status snapshot in this delivery. Missing or malformed Context data produces no new panel snapshot.
- Remaining Context percentage is `100 - used percentage`, bounded to the valid percentage range and formatted with at most one decimal place. Integer results omit `.0`.
- Used Context tokens use locale grouping. Total Context capacity uses compact English notation, producing values such as `258K` and `1M`.
- The Context line uses copy equivalent to `Remaining 96.6% (35,193 used / 1M total)`.
- Session ID is rendered in full and remains text-selectable. The Status panel adds no dedicated copy control; Thread context menus may offer a Session ID copy action.
- Optional Plan usage is represented as independent Weekly and 5h windows. Each valid window may contain a Runtime-reported used percentage and Runtime-reported reset text or duration.
- When a quota used percentage exists, Carrent may derive remaining percentage as `100 - used percentage`; it does not infer the used percentage itself.
- Reset information is displayed only from explicit Runtime data. Carrent does not calculate reset timestamps from account type, local time, previous values, or assumptions.
- Missing Weekly, missing 5h, missing reset information, and an entirely absent Plan usage section are all valid. The UI omits only the missing parts and shows no `Unavailable`, zero, or placeholder value.
- Malformed optional quota data is ignored independently and cannot invalidate otherwise valid Session and Context data.
- Carrent does not read Kimi credential files, call undocumented Kimi account endpoints, scrape the Kimi TUI, or run a parallel TUI process to obtain Plan usage.
- Real Kimi Code 0.29.1 ACP output currently does not provide Weekly, 5h, or reset values through `/status` or `/usage`; the optional contract is forward-compatible and produces no Plan usage UI for that observed version.
- Executing Status creates per-Thread transient loading state. While loading, sending, Compact, and another Status request are unavailable for that Thread. Other Threads remain usable.
- The existing panel snapshot, if any, remains visible while an explicit refresh loads. Success replaces it atomically. Failure preserves the prior snapshot and shows an error; an initial failure opens no panel.
- Each `/status` execution performs a fresh Runtime request. Carrent does not poll, schedule background refreshes, or automatically retry.
- Status snapshots and loading state are not persisted. Application restart restores neither.
- The panel is a Carrent-owned, non-modal surface immediately above the Composer. It has no backdrop and does not prevent reading or scrolling Message Timeline.
- The panel displays only Session, Context, and optional Plan usage. It does not show model, Thinking level, Project Working Directory, Runtime permission mode, Plan Mode, Thread title, or other Runtime fields.
- The panel uses English labels consistent with the current app: `Status`, `Session`, `Context`, `Plan usage`, `Weekly`, `5h`, and `Close`.
- The panel closes through its Close control or Escape. Sending a message, switching Thread, switching Runtime, or switching Project also closes it and clears its snapshot.
- Re-executing `/status` while a panel is open refreshes and updates the panel; it does not toggle the panel closed.
- Status failure uses concise Composer-adjacent feedback equivalent to `Unable to load session status.` It creates no Message Timeline content and does not discard draft text or attachments.
- The panel and command reuse existing Carrent visual tokens, focus treatment, keyboard interaction, and accessibility patterns. Loading exposes an accessible busy state, and all values have textual labels rather than relying on color or charts alone.
- The feature follows ADR-0002 by using ACP over stdio as the Kimi integration boundary. It does not introduce a second Runtime transport or require a new ADR.

## Testing Decisions

- Good tests assert user-visible command availability, preserved Composer content, mutual exclusion, rendered status values, dismissal behavior, errors, and normalized protocol results. They do not assert private React state, CSS class names, internal map layout, parser helper call order, or exact component decomposition.
- The primary test seam is the existing mounted Composer integration boundary. Tests provide Thread, Runtime, Run, Compact, and Session Status conditions through public app contracts, interact with the slash menu and Composer, and observe rendered behavior.
- Composer seam tests cover Status appearing after Compact and before Skills only when an existing Session advertises exact `status` capability.
- Composer seam tests cover Status remaining absent for a new Thread, missing Session mapping, unsupported Runtime, missing capability, active Run, active Compact, and active Status request.
- Composer seam tests cover manual `/status` interception while unavailable, including the unavailable error and proof that no normal Run or queued message starts.
- Composer seam tests cover menu selection and leading command submission sharing behavior, command-token removal, trailing draft preservation, attachment preservation, and no Message Timeline additions.
- Composer seam tests cover loading disabling send, Compact, and duplicate Status while leaving other Thread interaction outside the selected Thread unaffected.
- Composer seam tests cover initial success opening the non-modal panel with full Session ID and the agreed Context formatting.
- Composer seam tests cover remaining percentage precision, integer `.0` omission, grouped used tokens, and compact total notation.
- Composer seam tests cover Weekly and 5h rendering independently, used and derived remaining percentages, optional reset information, partial quota data, malformed optional quota data, and complete omission when quota data is absent.
- Composer seam tests cover a fresh request for every `/status`, successful refresh replacing an open snapshot, refresh loading preserving the current snapshot, refresh failure preserving it with an error, and initial failure opening no panel.
- Composer seam tests cover Close, Escape, sending, Thread switching, Runtime switching, and Project switching clearing the panel.
- Composer seam tests verify that the Context usage indicator retains existing hover behavior and gains no click-to-open interaction.
- Composer accessibility tests cover slash-menu keyboard selection, panel labeling, selectable Session text, Close keyboard access, Escape dismissal, busy state, and textual quota/context values.
- Renderer prior art is the existing mounted Compact behavior in the app-level Composer tests, slash-menu interaction tests, structured question panel tests, and Context usage indicator behavior.
- The second seam is the existing Kimi ACP adapter boundary using the fake ACP transport and real-shaped JSON-RPC messages.
- ACP adapter tests verify exact `status` capability discovery from `available_commands_update`, absence when only other commands are advertised, and suppression of raw status chunks from ordinary Agent output.
- ACP adapter tests verify normalization of the observed Kimi Code 0.29.1 `/status` shape: model posture lines may be present, Context is parsed, and absent Plan usage remains absent.
- ACP adapter tests cover optional future-shaped Weekly and 5h lines, independent partial fields, reset text, malformed percentages, chunked agent message content, and unknown additional lines.
- ACP adapter tests verify missing or malformed required Context data returns no new status snapshot rather than fabricated zero values.
- The third seam is the existing Chat Session Manager and IPC status operation boundary.
- Session Manager tests verify the mapped Runtime Session ID is included in the normalized result, the correct Thread + Runtime mapping is used, and no Session is created when the mapping is absent.
- Session Manager tests verify non-Kimi or unsupported Runtime requests remain unavailable in V1, deleted Threads return no status, and adapter failures do not escape as raw Runtime output.
- IPC prior art is the existing `chat:kimi-status` handler coverage and Compact Thread Action tests. The implementation may generalize naming, but tests should assert the public request/response behavior rather than handler internals.
- No persistence tests are required because Session Status snapshots and loading state are explicitly transient.
- No Message Timeline snapshot tests are required because Status output is intentionally excluded from conversation history.

## Out of Scope

- Calling Kimi private account, billing, membership, or quota endpoints.
- Reading or parsing Kimi credential files to obtain Coding Plan information.
- Scraping, embedding, automating, or launching the Kimi TUI to obtain its Status card.
- Displaying Weekly, 5h, reset time, or any other quota value when ACP does not return it.
- Inferring account plan, quota ceilings, billing cycle, reset schedule, or usage from HTTP errors, local history, token totals, or screenshots.
- Adding a separate `/usage` Carrent command or exposing raw token accounting for input, output, cache read, or cache creation.
- Displaying model, Thinking level, permission mode, Plan Mode, Project Working Directory, Thread title, Runtime version, or other Runtime `/status` fields.
- Turning the Context usage indicator into a Status panel button.
- Adding a persistent toolbar button, command palette item, context-menu item, Settings entry, or global status view.
- Persisting Session Status snapshots, restoring them after restart, or keeping historical status revisions.
- Automatic polling, scheduled refresh, refresh-on-focus, automatic retry, notifications, warnings, badges, or threshold-based actions.
- Creating a Runtime Session to detect capability or produce Status for a new Thread.
- Allowing Status during a live Run, Compact operation, or another Status request.
- Sending `/status` as an ordinary Coding Agent prompt when unavailable.
- Adding a dedicated Session ID copy button to the Status panel.
- Changing the existing Context usage circle's presentation or hover content beyond compatibility work required by the normalized status contract.
- Adding Status adapters for disabled non-Kimi V1 Runtimes in the first delivery.

## Further Notes

- `Runtime Session` is the canonical continuity term. The panel title is `Status`, but the feature must not be confused with `Thread Status`, which describes Running, waiting, Failed, and Compacting navigation state.
- Real ACP verification was performed against Kimi Code 0.29.1 using an existing Carrent Runtime Session. `available_commands_update` advertised both `status` and `usage`. `/status` returned model, Thinking, permission, Plan Mode, and `Context: 35,193 / 1,048,576 (3.4%)`. `/usage` returned token totals plus the same Context value. Neither returned Weekly, 5h, or reset information.
- A direct `kimi -p /status` invocation is not equivalent to the ACP command path: prompt mode treated it as a model request and returned a quota error. Implementation and tests must continue using ACP `session/prompt` against the resumed Runtime Session.
- The Kimi TUI screenshot proves that Kimi Code can obtain and render Coding Plan usage in its own product, but it does not establish an ACP contract. Carrent intentionally waits for Runtime-provided ACP data rather than copying TUI-only behavior through private integration.
- The latest confirmed refresh decision takes precedence over the earlier toggle suggestion: executing `/status` while the panel is open refreshes it; only Close, Escape, sending, or context changes dismiss it.
