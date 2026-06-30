# Kimi ACP V1 PRD

Status: done

## Problem Statement

Carrent 的目标是做一个好用的 Agent GUI，而不是重新实现一个 Coding Agent。当前 runtime 策略同时铺开 Codex、Claude Code、pi 等 CLI，导致产品验证被 runtime 兼容工作拖慢：每个 Runtime 都有自己的输出格式、session 语义、权限模型、model 参数和错误形态。

用户已经确认 Carrent V1 应该更明确地聚焦：Kimi Code 作为 Primary Runtime，Carrent 通过 ACP Runtime 边界驱动它。这样 Carrent 可以专注做好 project-scoped thread、chat run 展示、停止、错误处理、权限状态和后续 Provider Profile，而不是继续扩散成多 CLI 适配器集合或直接 API agent。

## Solution

Carrent V1 以 Kimi Code 作为 Primary Runtime，并通过 `kimi acp` 接入。Carrent 作为 ACP client，Kimi Code 作为 agent server，二者通过 stdio 上的 Agent Client Protocol 通信。

Codex、Claude Code 和 pi 在 V1 中关闭为不可用 Runtime。当前项目还未发布给用户，不需要为旧 runtime 提供可运行迁移路径；但已有配置和 persisted thread/runtime 数据仍应可读，避免开发期数据损坏和 migration 噪音。

第一阶段不直接重构整个 runtime 层，而是先做一个 Kimi ACP spike：启动 `kimi acp`，完成最小 session/prompt/run 闭环，观察真实事件，验证 project cwd、cancel、permission request、file I/O 和错误语义。spike 成功后，再把 Kimi ACP adapter 接入 Carrent 当前的 Chat run 边界，把 ACP 事件归一化为 Carrent 现有的 `ChatRunEvent`。

Carrent 不做 Direct API Agent。Provider/Profile 工作应围绕 Runtime 配置展开，而不是让 Carrent 自己拥有 Agent Loop。

## User Stories

1. As a Carrent user, I want Carrent V1 to focus on one Primary Runtime, so that the main Agent GUI experience becomes reliable before broader runtime compatibility is added.
2. As a Carrent user, I want Kimi Code to be the Primary Runtime, so that I can use a Coding Agent that does not already have a dominant desktop GUI in my workflow.
3. As a Carrent user, I want Carrent to drive Kimi Code through ACP, so that the GUI talks to an agent protocol rather than parsing ad hoc CLI output.
4. As a Carrent user, I want to send a message in a project thread and have Kimi Code work in that project, so that file reads, edits, and shell commands happen in the expected workspace.
5. As a Carrent user, I want Kimi Code responses to stream into the current thread, so that I can see progress instead of waiting for a final answer.
6. As a Carrent user, I want reasoning-like progress and tool activity to be displayed in Carrent's existing chat UI shape, so that Kimi Code feels native to Carrent.
7. As a Carrent user, I want shell/tool activity from Kimi Code to appear as structured run events, so that I can inspect what the Coding Agent did.
8. As a Carrent user, I want file edit activity from Kimi Code to be surfaced clearly, so that I understand when the Coding Agent changed my project.
9. As a Carrent user, I want failed ACP startup to produce an actionable error, so that I know whether Kimi Code is missing, not logged in, misconfigured, or incompatible.
10. As a Carrent user, I want Carrent to detect whether `kimi` is installed, so that I know if the Primary Runtime is available.
11. As a Carrent user, I want Carrent to show the installed Kimi Code version, so that runtime troubleshooting has a concrete starting point.
12. As a Carrent user, I want Carrent to preserve thread history around Kimi runs, so that I can continue work across app restarts.
13. As a Carrent user, I want Kimi session continuity to be verified before Carrent relies on it, so that resume behavior is not guessed.
14. As a Carrent user, I want to stop an in-flight Kimi run, so that I can interrupt a bad or long-running agent action.
15. As a Carrent user, I want permission requests to be represented honestly, so that Carrent does not show approve/deny controls that do not work.
16. As a Carrent user, I want Carrent to handle Kimi ACP permission events if ACP supports them, so that I can make safety decisions inside the GUI.
17. As a Carrent user, I want Carrent to fail safely when a permission mode is unsupported, so that the app does not imply false control over local actions.
18. As a Carrent user, I want model selection to use Kimi Code's supported mechanisms, so that Carrent can select a model without becoming a general API client.
19. As a Carrent user, I want Provider Profile work to configure Kimi Code rather than bypass it, so that Kimi Code continues to own the Agent Loop.
20. As a Carrent user, I want Codex, Claude Code, and pi to be unavailable in V1, so that the app can become excellent around one runtime first.
21. As a Carrent developer, I want a fake ACP transport in tests, so that behavior can be tested without spawning a real Kimi process.
22. As a Carrent developer, I want the ACP integration to emit standard Carrent ChatRunEvents, so that renderer code does not need to understand ACP directly.
23. As a Carrent developer, I want startup, prompt, stream, cancel, completion, and failure cases covered at the Chat run boundary, so that the integration is tested from the highest useful seam.
24. As a Carrent developer, I want the ACP spike to document real Kimi event shapes, so that implementation work is based on observed protocol behavior.
25. As a Carrent developer, I want the current spawn-and-parse logic to remain available for comparison during the spike, so that existing runtime behavior is not accidentally broken.
26. As a Carrent developer, I want the Kimi ACP adapter isolated from legacy CLI adapters, so that Kimi's protocol path does not inherit unnecessary Codex/Claude assumptions.
27. As a Carrent developer, I want Runtime terminology to distinguish Runtime, Primary Runtime, ACP Runtime, Provider Profile, and Agent Loop, so that future issues use consistent language.
28. As a Carrent maintainer, I want the Kimi ACP decision recorded in ADRs, so that future contributors understand why V1 is not API-first or multi-runtime-first.

## Implementation Decisions

- Carrent V1 uses Kimi Code as the Primary Runtime.
- Carrent integrates Kimi Code through ACP over stdio, using `kimi acp`.
- Carrent does not implement a Direct API Agent for V1.
- Carrent remains an Agent GUI: it drives a Runtime and presents project-scoped Coding Agent work.
- Kimi Code owns the Agent Loop.
- Carrent owns runtime selection, process lifecycle, thread persistence, event normalization, UI presentation, cancellation, and user-facing error states.
- The first implementation phase is an ACP spike, not a full runtime-layer rewrite.
- The spike must verify real Kimi ACP behavior for initialize/startup, session creation or loading, prompt submission, streaming output, completion, cancellation, permission events, file I/O, cwd/project semantics, and error states.
- After the spike, the Kimi path should be modeled as an ACP Runtime adapter rather than another CLI output parser.
- The Kimi ACP adapter should normalize protocol events into Carrent's existing Chat run event vocabulary.
- The renderer should continue consuming Carrent Chat run events rather than depending on ACP-specific shapes.
- Kimi model selection should use Kimi Code's runtime mechanisms, not direct API provider calls from Carrent.
- Provider Profile work should configure the selected Runtime with non-secret provider/proxy/model configuration.
- Codex, Claude Code, and pi are unavailable runtimes in V1.
- Existing Codex, Claude Code, and pi configuration should not be deleted during the Kimi V1 migration. Existing persisted threads/runtime records should continue to load without data loss, but new runs should not execute those runtimes.
- Existing docs define this decision:
  - ADR-0001: Use Kimi Code as the V1 primary runtime
  - ADR-0002: Integrate Kimi Code through ACP

## Testing Decisions

- The main test seam is the Chat run boundary.
- Tests should assert Carrent-visible behavior, not internal parser details.
- A fake ACP transport should drive the adapter in tests without requiring a real Kimi process.
- Test inputs should look like a user sending a ChatTurnRequest.
- Test outputs should be Carrent ChatRunEvents.
- Target behavior to test:
  - successful Kimi ACP run emits started, delta/progress events, and completed
  - ACP startup failure emits a useful failed event
  - invalid or missing Kimi runtime emits a useful failed event
  - cancellation stops the in-flight run and emits stopped
  - permission request events are surfaced or failed honestly according to observed ACP support
  - shell/tool/file activity is normalized into Carrent events without leaking ACP internals into the renderer
  - project workspace/cwd is passed correctly
  - model selection is passed through if supported by Kimi ACP
  - session continuity is tested only after the spike confirms the protocol semantics
- Existing test prior art:
  - runtime detection tests for local CLI availability
  - chat session manager tests for spawned runtime lifecycle and event emission
  - runtime model lister tests for fake process output
  - workspace persistence tests for thread runtime fields
- The ACP spike itself should include a short observed-protocol note before implementation tasks depend on exact event shapes.

## Out of Scope

- Direct OpenAI, Anthropic, Moonshot, or other provider API integration from Carrent.
- Building Carrent's own Agent Loop.
- Making Codex, Claude Code, pi, and Kimi Code equally first-class in V1.
- Keeping Codex, Claude Code, or pi runnable in the V1 product path.
- Deleting legacy Codex, Claude Code, or pi thread/runtime configuration as part of the initial Kimi migration.
- Rebuilding Provider Profile management before the Kimi ACP path is validated.
- Cloud sync, accounts, team features, marketplace, or IDE plugin work.
- Perfect ACP abstraction for every future runtime.
- UI redesign beyond what is necessary to expose Kimi as the Primary Runtime.
- Implementing speculative permission UI before real ACP permission behavior is verified.
- Depending on `kimi -p --output-format stream-json` as the primary V1 path.

## Further Notes

- This PRD follows the multi-context domain docs for the Desktop App context.
- The current codebase already has Carrent ChatRunEvent shapes, runtime detection, process lifecycle tests, and thread persistence that should guide the Kimi ACP integration.
- The next step should be `/to-issues`, starting with an independently runnable ACP spike issue before main product integration issues.
- Keep the first slice small: prove Carrent can speak to `kimi acp` and map one real run into Carrent's event vocabulary.
