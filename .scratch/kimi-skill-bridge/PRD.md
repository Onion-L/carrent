# Kimi Skill Bridge PRD

Status: ready-for-agent

## Problem Statement

Carrent 已经通过 ACP Runtime 接入 Kimi Code，并且本地已有 Skill Catalog 和 composer 里的 skill 选择体验。但 Kimi ACP session 目前只收到空的 MCP server 列表，导致 Runtime 无法通过 Carrent 管控的方式发现、读取和使用 Carrent 已安装的 skills。

用户需要在保留 Kimi ACP 交互审批能力的基础上，让 Kimi Code 能看到 Carrent 的 Skill Catalog，并按需加载完整 skill 内容和资源。这个能力不能退回到把所有 skill 内容塞进 prompt，也不能把用户主目录暴露成任意文件读取接口。

## Solution

Carrent 在每个 Kimi ACP session 上挂载 Carrent Bridge。Carrent Bridge 是一个 Carrent-owned HTTP MCP server，作为 Runtime 的能力入口，提供只读 skill 工具：

- `list_skills`
- `read_skill`
- `list_skill_resources`
- `read_skill_resource`

Kimi Code 通过 ACP session 中的 `mcpServers` 发现 Carrent Bridge，然后通过 MCP tool call 显式读取 Skill Catalog、某个 skill 的 `SKILL.md`，以及该 skill 根目录内允许读取的资源。Skill 读取是预授权只读能力，不弹交互审批，但需要记录日志；任何未来会执行脚本、写文件或联网的 Bridge 工具必须走 Carrent 的交互审批流。

Skill 根目录软链可以被支持，但 Carrent 必须记录 declared path 和 resolved real path。资源读取必须限制在该 skill 的 real root 内。跨 skill 读取必须通过新的显式 skill 读取完成，不能通过资源软链越界绕过。

## User Stories

1. As a Carrent user, I want Kimi Code to discover installed skills during a run, so that I can use Carrent-managed skills without manually pasting their full content.
2. As a Carrent user, I want Kimi Code to read a selected skill on demand, so that the Runtime can follow the skill instructions accurately.
3. As a Carrent user, I want Kimi Code to read skill resources when a skill references them, so that full skill behavior works instead of only the top-level `SKILL.md`.
4. As a Carrent user, I want skill loading to preserve Kimi ACP approvals, so that file edits and shell actions still require the expected safety flow.
5. As a Carrent user, I want skill reads to be explicit and logged, so that Carrent can explain which skills were used in a run.
6. As a Carrent user, I want Carrent not to inject every installed skill into the prompt, so that runs stay focused and do not waste context.
7. As a Carrent user, I want the composer's selected skill reference to remain useful, so that my intent is clear even when the Runtime loads the skill through the Bridge.
8. As a Carrent user, I want Kimi Code to discover skills even when I do not manually select one, so that the Runtime can choose a relevant skill when appropriate.
9. As a Carrent user, I want skill metadata to include names and descriptions, so that Kimi Code can choose a skill before reading its full content.
10. As a Carrent user, I want plugin-backed skills to be available through the same path as local skills, so that installed plugin capabilities are not second-class.
11. As a Carrent user, I want Codex and agents skills to be available through the same Skill Catalog, so that my existing skill setup continues to matter.
12. As a Carrent user, I want skill directory symlinks to work, so that my local skill organization does not break Carrent.
13. As a Carrent user, I want Carrent to block skill resource reads that escape the skill root, so that a skill cannot become arbitrary home-directory file access.
14. As a Carrent user, I want cross-skill loading to be explicit, so that a skill chain is visible and controlled by Carrent.
15. As a Carrent user, I want Bridge tools that only read skills not to spam approval prompts, so that normal skill use feels smooth.
16. As a Carrent user, I want future executable Bridge tools to require approval, so that read-only skill support does not weaken broader runtime safety.
17. As a Carrent user, I want Kimi session resume to keep Bridge access, so that continuing a thread does not lose skill capability.
18. As a Carrent user, I want Kimi model listing and status checks not to start unnecessary skill servers, so that background runtime checks stay cheap and predictable unless Bridge access is needed.
19. As a Carrent user, I want failed Bridge startup to produce a useful failed run state, so that I know why skills are unavailable.
20. As a Carrent user, I want a Bridge server to shut down when its run no longer needs it, so that Carrent does not leak local server processes or ports.
21. As a Carrent user, I want Bridge URLs and tokens to be scoped locally, so that unrelated local processes cannot casually call the skill tools.
22. As a Carrent developer, I want Skill Catalog to expose declared path and real path, so that symlink behavior can be handled deliberately.
23. As a Carrent developer, I want Skill Catalog to provide safe skill and resource reads, so that the Bridge does not duplicate path policy.
24. As a Carrent developer, I want Carrent Bridge to be runtime-neutral, so that future MCP-capable Runtimes can reuse it.
25. As a Carrent developer, I want the Kimi ACP adapter to receive Bridge server descriptors, so that session creation and session resume pass the same capability surface.
26. As a Carrent developer, I want Bridge tools to return structured errors, so that Kimi Code gets clear feedback when a skill or resource is unavailable.
27. As a Carrent developer, I want Bridge lifecycle to be owned by the chat run path, so that cleanup happens with normal run completion, failure, stop, and invalid session fallback.
28. As a Carrent developer, I want fake transports and fake Bridge services in tests, so that tests do not need real Kimi Code or a real skill installation.
29. As a Carrent developer, I want tests to assert Carrent-visible behavior, so that implementation details can change without breaking useful guarantees.
30. As a Carrent maintainer, I want the decision recorded in ADRs and the Desktop App glossary, so that future contributors do not replace the Bridge with prompt dumping.
31. As a Carrent maintainer, I want skill read auditing to exist from the first implementation, so that later permission and observability work has a place to attach.
32. As a Carrent maintainer, I want Bridge tool names to be stable, so that prompts, tests, and future runtime integrations can rely on them.
33. As a Carrent maintainer, I want the Bridge to use the ACP-supported HTTP MCP server shape, so that it follows behavior already verified in the prototype.
34. As a Carrent maintainer, I want resource size and text decoding behavior to be bounded, so that a large skill asset cannot destabilize a run.
35. As a Carrent maintainer, I want unsupported binary resources to fail clearly, so that skill authors know when a resource is not readable through this Bridge.

## Implementation Decisions

- Carrent keeps Kimi Code connected through ACP.
- Carrent attaches Carrent Bridge to every Kimi ACP chat session.
- Carrent Bridge is an HTTP MCP server owned by Carrent.
- Carrent Bridge is not Kimi-specific; it is a Runtime capability surface that can be reused by future MCP-capable Runtimes.
- The first Bridge capability is read-only Skill Catalog access.
- Carrent Bridge exposes exactly four initial skill tools: `list_skills`, `read_skill`, `list_skill_resources`, and `read_skill_resource`.
- `list_skills` returns skill metadata needed for discovery, including name, description, source, and stable identity fields.
- `read_skill` reads a specific skill's `SKILL.md` and returns enough path metadata for Carrent to explain declared path versus real path.
- `list_skill_resources` lists readable resources under a selected skill root.
- `read_skill_resource` reads a specific text resource under a selected skill root.
- Skill reads are pre-authorized read-only operations and do not trigger Carrent's interactive approval UI.
- Skill reads must be logged or otherwise made auditable.
- Future Bridge tools that execute scripts, write files, mutate project state, or access the network must use Carrent's interactive approval flow.
- Skill content must be loaded on demand through Bridge tools, not injected wholesale into the prompt.
- The existing composer skill prefix remains a user intent signal, not the only way for Kimi Code to access skill content.
- Skill Catalog must distinguish declared path from real path.
- Skill root symlinks are allowed when the catalog resolves and records the real root.
- Resource reads must remain inside the selected skill's real root.
- Skill-internal resource symlinks that resolve outside the selected skill real root are rejected.
- If a resource points to another installed skill, Kimi Code must explicitly call `read_skill` for that other skill.
- Cross-skill loading is explicit and separately audited.
- Bridge server descriptors are passed through ACP `mcpServers` for both new and resumed Kimi sessions.
- The ACP server descriptor uses the HTTP MCP shape verified by the prototype: id, name, type, local URL, and headers.
- Bridge access should be local-only and scoped per run or per session with a token or similarly narrow URL.
- Bridge lifecycle should be tied to the Kimi chat run path and cleaned up on completion, failure, stop, and startup errors.
- Kimi model listing and status checks do not need Bridge access unless they become real chat runs.
- The implementation must respect ADR-0002 and ADR-0004.

## Testing Decisions

- The primary test seam is the Kimi ACP chat run boundary.
- Tests at the primary seam should use a fake ACP transport and assert that new and resumed sessions receive a non-empty Bridge MCP server descriptor.
- Primary seam tests should assert that Bridge lifecycle cleanup happens when a run completes, fails, or is stopped.
- Primary seam tests should assert Carrent-visible run behavior, not internal transport implementation details.
- Skill Catalog tests should cover declared path and real path behavior.
- Skill Catalog tests should cover symlinked skill roots.
- Skill Catalog tests should cover rejecting resource reads that resolve outside the selected skill root.
- Skill Catalog tests should cover explicit cross-skill behavior by making direct resource traversal fail while direct skill lookup succeeds.
- Skill Catalog tests should cover invalid skill metadata and unreadable resources.
- Carrent Bridge tests should exercise the MCP tool behavior through the Bridge's public request surface.
- Carrent Bridge tests should cover `list_skills`, `read_skill`, `list_skill_resources`, and `read_skill_resource`.
- Carrent Bridge tests should assert structured errors for missing skills, missing resources, unsupported resource types, and path escape attempts.
- Carrent Bridge tests should avoid requiring a real Kimi process.
- Carrent Bridge tests should avoid depending on the user's real home directory skill installation.
- Existing prior art includes Skill Catalog tests for installed skill discovery, Skill IPC tests for renderer-facing listing, Kimi ACP chat tests with fake transports, and Chat Session Manager tests at the chat run boundary.
- Tests should focus on external behavior: what Carrent passes to ACP, what Bridge tools return, and what unsafe reads are refused.

## Out of Scope

- Replacing Kimi ACP with `kimi -p`.
- Injecting all installed skill content into every prompt.
- Native Kimi skill installation or Kimi-owned skill discovery.
- A marketplace or remote skill registry.
- Editing or installing skills.
- Running skill scripts through the Bridge in this PRD.
- Writing files through the Bridge in this PRD.
- Network access through the Bridge in this PRD.
- Interactive approval UI changes for read-only skill access.
- General arbitrary file reading outside installed skill roots.
- Binary resource streaming.
- Renderer redesign of the skill picker.
- Making Codex, Claude Code, or pi consume Carrent Bridge in this PRD.
- Perfect MCP abstraction for every future runtime.

## Further Notes

- This PRD follows the Desktop App context glossary terms: Runtime, ACP Runtime, Agent GUI, Coding Agent, Carrent Bridge, and Skill Catalog.
- ADR-0004 records the architectural decision to expose skills through Carrent Bridge.
- The prototype verified that Kimi ACP accepts an HTTP MCP server through `mcpServers` and can call tools under names such as `mcp__carrent_bridge__echo`.
- The implementation can be split into three independent slices: Skill Catalog safe reads, Carrent Bridge MCP server, and Kimi ACP session integration.
