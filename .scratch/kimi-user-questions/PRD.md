# Kimi Structured User Questions PRD

Status: done

## Problem Statement

Carrent drives Kimi Code as its Primary Runtime through ACP, but a Coding Agent cannot currently pause a Run and collect structured user input reliably inside the Agent GUI. Kimi Code has a built-in `AskUserQuestion` tool, yet its current ACP adapter degrades the interaction to the first question and a single selected option. Multiple questions, multi-select answers, option descriptions, and the automatic `Other` free-text answer are lost before Carrent receives the request. Carrent also renders the resulting ACP request as a generic Approval Request, exposing only one approve action instead of the actual choices.

Users need Kimi Code to ask meaningful questions during a Run without falling back to plain assistant text. The interaction must appear in the current Thread, temporarily replace the Composer, return the chosen answers to the same Run, survive navigation between Threads, and remain understandable in Thread history after completion.

## Solution

Carrent adds a Run-scoped HTTP MCP server named `carrent_session`. In supported Kimi modes it exposes `ask_user_question`, whose input and output contract follows Kimi Code's full structured-question contract: one to four questions, two to four described options per question, per-question single-select or multi-select behavior, an automatic `Other` choice with free-text input, and an `answers` object keyed by question text.

When the tool is called, Carrent binds the request to the active Run and Thread, emits a transport-neutral structured-question event, and keeps the MCP call pending until the user submits or skips. The Composer is replaced by a question panel. Multiple questions are presented one at a time with retained answers and explicit back, next, and submit actions. Once resolved, the normal Composer returns and a compact record of the questions and final answers remains in Agent Activity.

Kimi's native ACP `AskUserQuestion` bridge remains supported as a degraded compatibility path. Carrent detects it separately from an Approval Request and presents the single question and options that Kimi ACP actually forwards. The Run-scoped MCP tool is the preferred full-fidelity path, communicated through its tool description without modifying user prompts.

## User Stories

1. As a Carrent user, I want Kimi Code to ask me a structured question during a Run, so that I can guide work without composing a separate message.
2. As a Carrent user, I want a structured question to appear in the Thread that owns the Run, so that I never answer the wrong Coding Agent.
3. As a Carrent user, I want the question panel to replace the Composer, so that it is clear the current Run is waiting for an answer rather than a new user message.
4. As a Carrent user, I want normal message input to be unavailable while a question is pending, so that queued or steering messages are not confused with question answers.
5. As a Carrent user, I want each supplied option to be shown as an interactive choice, so that I do not need to type option numbers manually.
6. As a Carrent user, I want option descriptions to be visible, so that I can understand the trade-offs before choosing.
7. As a Carrent user, I want single-select questions to accept exactly one option, so that my answer is unambiguous.
8. As a Carrent user, I want multi-select questions to accept several options, so that I can express combinations the Coding Agent requested.
9. As a Carrent user, I want every question to include an automatic `Other` option, so that I am not limited to the Coding Agent's suggested choices.
10. As a Carrent user, I want selecting `Other` to reveal a dedicated free-text input, so that I can provide a custom answer inside the question panel.
11. As a Carrent user, I want `Other` to be combinable with predefined choices in a multi-select question, so that adding context does not discard my selected options.
12. As a Carrent user, I want `Other` to replace the predefined choice in a single-select question, so that a single-choice answer remains singular.
13. As a Carrent user, I want a Run to ask several related questions in one interaction, so that clarification does not require repeated interruptions.
14. As a Carrent user, I want multiple questions presented one at a time, so that the Composer area remains focused and compact.
15. As a Carrent user, I want to see my position in a multi-question interaction, so that I know how many questions remain.
16. As a Carrent user, I want explicit next and submit actions, so that selecting an option does not accidentally send an answer.
17. As a Carrent user, I want to return to an earlier question, so that I can review and revise an answer before final submission.
18. As a Carrent user, I want earlier selections and custom text retained while navigating between questions, so that reviewing an answer does not lose work.
19. As a Carrent user, I want submission disabled until every question has a valid answer, so that the Coding Agent receives a complete response.
20. As a Carrent user, I want to skip the entire question request without stopping the Run, so that the Coding Agent can make a reasonable decision when I do not want to answer.
21. As a Carrent user, I want skipping to be distinct from stopping the Run, so that dismissal and cancellation have different effects.
22. As a Carrent user, I want to stop a Run while a question is pending, so that I remain in control of an unwanted or obsolete task.
23. As a Carrent user, I want pending questions to have no fixed business timeout, so that I can inspect information before answering.
24. As a Carrent user, I want to switch to another Thread while a question is pending, so that one paused Run does not block the rest of the Agent GUI.
25. As a Carrent user, I want the originating Thread to show a waiting-for-answer status, so that I can find the pending interaction again.
26. As a Carrent user, I want returning to the originating Thread to restore the same question and selections, so that navigation does not reset my progress.
27. As a Carrent user, I want the normal Composer restored immediately after submitting or skipping, so that the Thread returns to its standard interaction state.
28. As a Carrent user, I want completed questions and answers preserved as a compact Agent Activity item, so that later Thread review explains why the Coding Agent continued in a particular direction.
29. As a Carrent user, I want skipped and interrupted questions represented honestly in history, so that an unanswered question is not shown as completed.
30. As a Carrent user, I want a pending question interrupted when its Run ends, fails, or is cancelled, so that stale UI cannot answer a dead Run.
31. As a Carrent user, I want a late response rejected after its Run ends, so that it cannot affect another Run.
32. As a Carrent user, I want structured questions available in Kimi default, Plan, and YOLO modes, so that clarification works in the modes where Kimi permits user questions.
33. As a Carrent user, I want Kimi Auto mode to remain uninterrupted, so that enabling automatic execution does not introduce question pauses.
34. As a Carrent user, I want structured questions to work even when the user-controlled Local MCP Server is disabled, so that this Run interaction is independent of Skill Catalog availability.
35. As a Carrent user, I want native Kimi ACP questions to remain usable, so that an unexpected choice of Kimi's built-in tool does not appear as a misleading approval prompt.
36. As a Carrent user, I want native ACP limitations surfaced without fabricated data, so that Carrent never invents dropped questions or selections.
37. As a Carrent developer, I want the question contract to match Kimi's existing field names and answer shape, so that the Coding Agent can consume responses predictably.
38. As a Carrent developer, I want structured-question events to be transport-neutral, so that the Renderer does not depend directly on MCP or ACP payloads.
39. As a Carrent developer, I want every question request bound to a Run and Thread by Carrent rather than model-supplied identifiers, so that routing is trustworthy.
40. As a Carrent developer, I want at most one pending question request per Run, so that concurrent tool calls cannot compete for the Composer.
41. As a Carrent developer, I want a second request during an active question to receive a structured error, so that the Coding Agent can recover instead of hanging.
42. As a Carrent developer, I want the MCP HTTP request to resolve only after submit or skip, so that the Agent Loop naturally waits for the user's decision.
43. As a Carrent developer, I want Run cancellation and server shutdown to abort pending MCP calls, so that local HTTP connections do not leak.
44. As a Carrent developer, I want the Run-scoped MCP server to use a local-only authenticated URL, so that unrelated local callers cannot create Carrent interactions.
45. As a Carrent developer, I want the Run-scoped MCP server to close on completion, failure, cancellation, startup failure, and application shutdown, so that ports and pending promises are released.
46. As a Carrent developer, I want the full MCP path and degraded ACP path distinguishable in logs and tests, so that routing behavior can be measured and debugged.
47. As a Carrent developer, I want the full MCP tool description to direct Kimi toward the Carrent interaction path, so that no repeated instruction is added to user prompts.
48. As a Carrent developer, I want Thread persistence to normalize pending questions as interrupted after restart, so that a restored workspace never displays an actionable request without a live Run.
49. As a Carrent developer, I want the Renderer response channel to validate the Run, request, question, and selected values, so that stale or malformed answers cannot resolve a different request.
50. As a Carrent maintainer, I want the feature tested at the Kimi Chat Run boundary, so that protocol, lifecycle, routing, and answer behavior are verified together.
51. As a Carrent maintainer, I want question UI tests to assert user-visible behavior, so that internal state management can change without weakening the interaction contract.
52. As a Carrent maintainer, I want the distinction between the user-controlled Local MCP Server and the internal Run interaction server documented, so that later changes do not accidentally couple their settings or lifecycle.

## Implementation Decisions

- Carrent keeps Kimi Code as the Primary Runtime and continues to drive it through ACP.
- Carrent adds a Run-scoped HTTP MCP server named `carrent_session`; it is an internal interaction surface, not a globally installable MCP server.
- The existing user-controlled Local MCP Server and its Skill Catalog tools remain a separate global capability surface.
- The Run-scoped server starts only for a live Kimi Run in default, Plan, or YOLO mode. Kimi Auto mode does not receive it.
- The Run-scoped server is independent of the Local MCP Server preference and is not disabled when Skill Catalog access is disabled.
- The Run-scoped server is bound by Carrent to the active Run and Thread. The Coding Agent does not supply routing identifiers.
- The server is local-only, uses an unguessable capability URL or token, and is passed to new and resumed Runtime Sessions through ACP `mcpServers`.
- The server exposes one tool, `ask_user_question`, and its description tells Kimi to prefer it over the built-in `AskUserQuestion` while connected to Carrent.
- Carrent does not inject question-routing instructions into user prompts. Tool name, description, and schema are the only preference signal in the first delivery.
- The input contract follows Kimi's structured question vocabulary: a `questions` array with one to four unique question texts; each question has a short header, two to four uniquely labeled options with optional descriptions, and a `multi_select` boolean.
- `background` is not accepted or advertised.
- Carrent adds `Other` in the question panel; the Coding Agent must not include it in the supplied options.
- A single-select `Other` answer is exclusive. A multi-select `Other` answer can be combined with predefined selections.
- The MCP result follows Kimi's public result shape: an `answers` object keyed by question text. Multi-select values use comma-separated selected labels plus custom text when supplied.
- Skipping returns an empty `answers` object and a dismissal note compatible with Kimi's built-in behavior.
- A question tool call remains pending without a Carrent business timeout. Transport disconnect, Run termination, or application shutdown interrupts it.
- Each Run may own at most one pending structured-question request. A concurrent request receives a structured `question_already_pending` tool error.
- Carrent defines transport-neutral question request, answer, resolution, and failure contracts in the shared chat protocol.
- The main process emits question lifecycle events to the Renderer and exposes a dedicated validated response IPC operation. Structured questions do not reuse Approval Request response types.
- Kimi's native ACP `AskUserQuestion` request is detected by its ACP tool-call identity and normalized into the same shared question contract instead of a generic Approval Request.
- The native ACP compatibility path displays only the first, single-select question and choices Kimi actually forwarded. Carrent does not claim support for data discarded by the upstream ACP adapter.
- The Composer has mutually exclusive normal and question modes. A pending question replaces the complete Composer surface, including text input, attachments, Skill controls, Runtime controls, and queued-message controls.
- The question panel presents one question at a time, shows progress, retains all draft answers, and provides explicit back, next, submit, skip, and stop actions as applicable.
- The final submit action is unavailable until every question has a valid selection and any selected `Other` has non-empty custom text.
- Resolving or skipping restores the normal Composer. Stopping the Run follows existing Run cancellation behavior.
- A pending question remains attached to its originating Thread while the user navigates elsewhere. Thread Status gains a waiting-for-answer state with precedence equivalent to other attention-requiring interaction states.
- Resolved, skipped, and interrupted questions are stored as a dedicated Agent Activity message part. Completed records show each question and final answer in compact form without repeating unselected options.
- Workspace persistence accepts settled question records and converts persisted pending records to interrupted during hydration.
- Run completion, failure, cancellation, Thread deletion, Runtime Session failure, MCP disconnect, and app shutdown clear actionable question state and reject late responses.
- Logs and tests distinguish full MCP questions from degraded native ACP questions without recording free-text answer contents in diagnostic metadata.
- This delivery intentionally contradicts the current ADR-0005 statement that disabling the Local MCP Server disables every Carrent-provided local MCP capability. ADR-0005 and the Desktop App definition of Local MCP Server must be updated to exclude the internal Run interaction server while preserving the user's control over global Skill Catalog capabilities.

## Testing Decisions

- Good tests assert Carrent-visible behavior and protocol results rather than internal promise maps, React state variables, or server implementation details.
- The primary test seam is the full Kimi Chat Run boundary using a fake ACP transport and a real ephemeral Run-scoped MCP server.
- Primary seam tests invoke `ask_user_question` through the public MCP HTTP endpoint, observe the shared pending-question event, submit a Renderer-style response, and assert the final Kimi-compatible tool result.
- Primary seam tests cover single question and multiple question requests, single-select and multi-select answers, option descriptions, automatic `Other`, combined multi-select custom answers, and final answer formatting.
- Primary seam tests cover skip, explicit Run stop, Run completion, failure, transport disconnect, application shutdown, and late response rejection.
- Primary seam tests cover the one-pending-question invariant and the `question_already_pending` response.
- Primary seam tests cover new and resumed Runtime Sessions receiving both the applicable global Carrent Bridge descriptor and the Run-scoped interaction descriptor.
- Primary seam tests assert that Auto mode omits the interaction server while default, Plan, and YOLO modes include it.
- Primary seam tests assert that disabling the user-controlled Local MCP Server removes Skill Catalog access but does not remove the Run-scoped interaction server.
- Native ACP compatibility tests feed a real-shaped `session/request_permission` payload titled `AskUserQuestion` and assert that it becomes a structured question rather than an Approval Request.
- Native ACP compatibility tests assert that only forwarded data is displayed and that skip or cancellation maps back to the upstream option identifiers.
- Renderer tests cover the Composer being fully replaced, progressive question navigation, retained draft answers, validation, explicit submit, skip, stop, and restoration of the normal Composer.
- Renderer tests cover single-select exclusivity, multi-select toggling, `Other` text entry, multi-select plus `Other`, keyboard focus, accessible labels, and disabled states.
- Message timeline tests cover compact completed answers, skipped state, interrupted state, and omission of unselected options.
- Thread state tests cover waiting-for-answer precedence, navigation away from and back to a pending question, and preserving the request on its originating Thread.
- Persistence tests cover round-tripping settled question message parts and converting pending persisted parts to interrupted on hydration.
- IPC tests cover valid answers, malformed selections, stale request identifiers, wrong Run identifiers, duplicate responses, and responses after termination.
- Existing prior art includes fake-transport Kimi ACP Run tests, public HTTP Carrent Bridge tests, Chat Run coordinator tests, Composer behavior helpers, Message Timeline rendering tests, interrupted Run reconciliation, and workspace persistence normalization.

## Out of Scope

- Supporting `background: true` or asynchronous question tasks.
- Adding structured-question support to Codex, Claude Code, or pi Runtime adapters.
- Replacing Kimi ACP or modifying Kimi Code's upstream ACP adapter.
- Reconstructing multiple questions, multi-select intent, option descriptions, or `Other` data already discarded by Kimi's native ACP bridge.
- Injecting question-routing instructions into every user prompt or every Run.
- Exposing the Run-scoped interaction server to external MCP clients or the global MCP settings UI.
- Allowing a Coding Agent to provide or choose Carrent Run or Thread routing identifiers.
- Allowing several pending question calls in one Run.
- Skipping only one question within a multi-question request.
- Persisting an actionable question across application restart without a live Run.
- Redesigning generic Approval Request UI beyond separating native Kimi questions from approvals.
- Changing the message queue's behavior after a Run finishes.
- OS-level notifications for pending questions.

## Further Notes

- This PRD uses the Desktop App context terms Coding Agent, Thread, Runtime Session, Run, Thread Status, Agent GUI, Primary Runtime, ACP Runtime, Carrent Bridge, Local MCP Server, Skill Catalog, and Agent Activity.
- Official Kimi Code source confirms that built-in `AskUserQuestion` supports one to four questions, per-question multi-select, automatic `Other`, and Kimi-compatible `answers`, while its current ACP adapter deliberately degrades to the first question and single-select through `session/request_permission`.
- The preferred MCP path is necessary for full fidelity; the native ACP path exists only so an unexpected built-in tool call remains usable and honest.
- The new interaction server is Run-scoped rather than Runtime Session-scoped: a resumed Runtime Session receives a fresh server descriptor for each live Run, and the server closes when that Run terminates.
- ADR-0002 and ADR-0004 remain compatible with this design. ADR-0005 and the Local MCP Server glossary entry require a narrow revision because the internal Run interaction server remains available when the user disables global local MCP capabilities.
