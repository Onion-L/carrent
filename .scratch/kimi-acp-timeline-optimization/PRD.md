# Kimi ACP Timeline Optimization

Status: ready-for-agent

## Problem Statement

Carrent 已经可以接收 Kimi ACP 的 `thinking`、`message`、`tool_call` 和 `tool_call_update` 事件，但当前 Kimi ACP adapter 和 renderer 会把不同类型的活动压平到少数通用事件中。结果是 Thinking 内容被过滤，generic tool 被误显示为 reasoning，工具更新可能重复或覆盖，失败和取消状态不完整，最终答复依赖 `lastActivityIndex` 等位置推断，用户无法可靠地看到一次 Run 的真实执行顺序。

这会削弱 Carrent 作为 Agent GUI 的核心体验：用户看不到 Coding Agent 先想什么、何时输出消息、调用了哪个工具、工具如何结束，也无法区分正常完成、拒绝、取消和迟到事件。

## Solution

为 Kimi ACP 增加一个 Run-scoped 的事件归一化层，把 ACP session updates 转换为带稳定 id 和顺序的 Kimi Timeline。Timeline 保留 Thinking phase、message segment 和统一的 tool item，并由 renderer 按首次出现顺序展示。

Thinking 默认折叠但可展开；连续的 thinking chunk 合并为一个 phase；tool、plan 或 agent message 会结束当前 phase。连续的 agent message chunk 合并为一个 message segment，多个 segment 保留原始顺序，只有本轮 `session/prompt` response 确认的有效 agent message 才会被标记为最终答复。

工具通过 `toolCallId` 合并，shell tool 和 generic tool 使用同一种 timeline item。工具状态、输出、错误和取消状态完整展示。`session/prompt` 的 `stopReason` 是本轮唯一的正常结束依据；terminal 后的迟到 ACP 事件被忽略，不得改变已结束的 Run。

这次改动只针对 Kimi ACP 的归一化和展示，不增加 summary 模型请求，不重写共享 Chat event 系统，不改变其他 Runtime 的现有事件处理。

## User Stories

1. 作为 Carrent 用户，我希望看到 Kimi Run 的 Thinking phase，这样我能知道 Coding Agent 当前正在分析什么。
2. 作为 Carrent 用户，我希望 Thinking 默认折叠，这样长时间运行的 Run 不会被大量思考内容占满。
3. 作为 Carrent 用户，我希望能够展开任意 Thinking phase，这样需要排查行为时仍能查看完整的可展示思考摘要。
4. 作为 Carrent 用户，我希望连续的 thinking chunk 显示为一个 Thinking phase，这样流式更新不会产生大量重复条目。
5. 作为 Carrent 用户，我希望 tool、plan 或 agent message 到来时当前 Thinking phase 结束，这样时间线能清楚表达 Agent Loop 的阶段切换。
6. 作为 Carrent 用户，我希望后续新的 thinking chunk 创建新的 phase，这样不同阶段的思考不会被错误拼接。
7. 作为 Carrent 用户，我希望看到 Thinking phase 的 running、completed 和 cancelled 状态，这样我能判断该阶段是否正常结束。
8. 作为 Carrent 用户，我希望连续的 agent message chunk 合并为一个 message segment，这样流式文本不会被拆成许多消息。
9. 作为 Carrent 用户，我希望多个不连续的 message segment 按 ACP 首次出现顺序显示，这样我能看到 Coding Agent 在工具调用前后的消息位置。
10. 作为 Carrent 用户，我希望最终答复由 Run 的结束结果明确标记，这样最终答复不依赖某个活动条目的位置猜测。
11. 作为 Carrent 用户，我希望 permission、notification 等控制性消息不会被显示成最终答复，这样控制流不会污染聊天记录。
12. 作为 Carrent 用户，我希望看到 generic tool 的标题和类型，这样非 shell 工具也能被识别为工具活动。
13. 作为 Carrent 用户，我希望 shell tool 和 generic tool 使用一致的展示方式，这样我不需要根据工具来源理解不同的 UI 规则。
14. 作为 Carrent 用户，我希望同一个 `toolCallId` 的 start 和 update 显示为一个工具项，这样一次工具调用不会重复出现多张卡片。
15. 作为 Carrent 用户，我希望工具 update 保持工具首次出现的位置，这样工具完成时不会跳到时间线末尾。
16. 作为 Carrent 用户，我希望即使 update 先于 start 到来，工具项也能先显示并在后续补齐信息，这样事件乱序不会让活动消失。
17. 作为 Carrent 用户，我希望并行工具通过不同 id 分别显示，这样一个工具的输出不会覆盖另一个工具。
18. 作为 Carrent 用户，我希望缺少 `toolCallId` 的工具仍有唯一标识，这样多个无 id 工具不会互相覆盖。
19. 作为 Carrent 用户，我希望看到工具的 input、output 和 error，这样我能判断工具实际收到了什么以及返回了什么。
20. 作为 Carrent 用户，我希望看到 pending、running、completed、failed 和 cancelled 工具状态，这样失败和取消不会被误显示成成功。
21. 作为 Carrent 用户，我希望工具失败状态和错误信息保留在时间线中，这样我能从 Run 历史定位失败原因。
22. 作为 Carrent 用户，我希望停止 Kimi Run 后仍能看到当前 Thinking 和工具已被取消，这样停止操作的结果是明确的。
23. 作为 Carrent 用户，我希望已经完成的工具不会被迟到的普通 update 改回 running，这样历史状态不会倒退。
24. 作为 Carrent 用户，我希望 `end_turn`、`max_tokens` 和 `max_turn_requests` 都能结束本轮 Run，这样协议允许的正常终态都能正确显示为 completed。
25. 作为 Carrent 用户，我希望 `cancelled` 显示为 stopped，这样用户停止和 Runtime 报告取消都使用一致的 Run 结果。
26. 作为 Carrent 用户，我希望 `refusal` 显示为 failed，这样 Runtime 拒绝不会被误认为正常完成。
27. 作为 Carrent 用户，我希望 terminal 之后的迟到事件不会改变时间线和 Run 状态，这样结束后的传输噪音不会污染历史。
28. 作为 Carrent 用户，我希望未知 ACP session update 被安全忽略，这样 Kimi 增加事件类型时当前 Run 不会无故失败。
29. 作为 Carrent 用户，我希望收到 `plan` 时现有 Run Checklist 仍然更新，这样计划进度和活动时间线可以同时使用。
30. 作为 Carrent 用户，我希望 plan update 不会改变已有 Thinking、message 和 tool 的顺序，这样 Checklist 不会重排 Agent Activity。
31. 作为 Carrent 用户，我希望即使当前 Kimi CLI 没有发送 plan，Run 也能正常工作，这样 plan 是可选能力而不是运行前提。
32. 作为 Carrent 用户，我希望 Kimi Run 不会因为时间线整理而额外请求 summary，这样响应时间和模型调用次数不会增加。
33. 作为 Carrent 用户，我希望重新打开 Thread 后仍能看到同样的 Kimi 活动顺序和终态，这样历史重放不会丢失时间线语义。
34. 作为 Carrent 用户，我希望其他 Runtime 的 Thinking、shell 和最终答复行为保持不变，这样新增 Kimi 能力不会引入跨 Runtime 回归。

## Implementation Decisions

- 在 Kimi ACP Run 边界建立单一的、Run-scoped 的 timeline normalizer。它负责维护当前 Thinking phase、message segment、tool item、全局 order、事件序号和 Run terminal 状态；renderer 不再从通用消息位置反推 Kimi 的语义。
- Kimi Timeline 由三类 item 组成：Thinking item、message item 和 tool item。每个 item 都有稳定 id 和首次出现时分配的 order；同一个 item 的后续 update 只改变内容和状态，不改变 order。
- Thinking item 的 phase 边界由 ACP 事件类型决定：连续 `agent_thought_chunk` 合并；`tool_call`、`tool_call_update`、`plan` 或 `agent_message_chunk` 结束当前 phase；下一段 thinking 创建新 item。
- message item 只接收有效的 `agent_message_chunk` 文本。连续 chunk 合并到当前 segment；被其他 timeline item 分隔后创建新 segment。控制性 ACP 消息不能创建或完成最终 message。
- `session/prompt` response 是最终答复确认点。normalizer 在确认本轮 response 后，将最后一个有效 agent message segment 标记为 `isFinal`，并从这些最终 segment 按原始顺序形成 terminal 的 `finalText`。最终标记不依赖 `lastActivityIndex` 或 renderer 的数组位置。
- tool item 以 `toolCallId` 作为合并键。start 首次创建 item，update 只更新已有 item；update 先到时创建可补齐的临时 item。缺少 id 时使用当前 Run id 和单调递增事件序号生成唯一 id，不使用全局固定 sentinel。
- shell tool 与 generic tool 统一为同一 tool timeline contract，至少保留 id、title、kind、input、output、error、status 和 order。shell command 是可选的展示派生字段，不再决定 item 是否属于工具时间线。
- 工具状态统一映射为 `pending`、`running`、`completed`、`failed`、`cancelled`。未知或缺失的中间状态按当前协议兼容规则处理，但 terminal 后的已结束 item 不允许被普通 update 回退。
- normalizer 通过现有 Chat run event channel 发布 Kimi-specific 的有序 timeline 更新，并保留现有 Run、permission、question、Run Checklist 和 Runtime Session 生命周期。不得建立第二条并行的 Kimi 传输通道，也不得把 ACP 原始事件全部暴露给 renderer。
- 共享聊天消息表示需要保留 Kimi item 的 id、order、segment 合并结果、最终标记和终态，以支持实时更新、持久化和 Thread 重放。其他 Runtime 继续使用已有的 delta、reasoning、shell 等事件映射。
- renderer 按 order 渲染 Thinking、message 和 tool。Thinking 作为可展开的活动项默认折叠；message segment 在原始位置显示；只有 `isFinal` 的 segment 进入最终答复区域；generic tool 的 output、error 和状态在工具项中可见。
- `session/prompt` 的终态映射固定为：`end_turn`、`max_tokens`、`max_turn_requests` -> completed；`cancelled` -> stopped；`refusal` -> failed。未识别的 stop reason 作为失败处理并保留原因。
- 取消或 terminal 时，所有仍为 running 的 Thinking 和 tool item 进入 cancelled；已完成、已失败或已取消的 item 保持原状态。terminal 事件只允许发布一次，迟到 update 和迟到 transport close 都不能改变 Run。
- `plan` 继续驱动现有 Run Checklist；第一版不把 plan 作为 assistant message timeline item。plan 只能结束当前 Thinking phase，不能插入、删除或重排已存在的 timeline item。
- 未知 ACP update 只被忽略并继续当前 Run。只有可识别的 prompt response、transport error、明确 refusal 或明确取消才参与 Run terminal 决策。
- 保持 ADR-0002 关于 ACP over stdio 的边界和 ADR-0011 关于 unknown Kimi output 必须降级而不能失败 parent Run 的决策。用户要求的 Thinking 默认折叠与 ADR-0008 中“Run 开始时活动区展开”的既有行为存在冲突；本 spec 将 Kimi Timeline 的单个 Thinking item 默认折叠作为本次更具体的产品行为，整体 Agent Activity 仍保留同一活动 surface，后续实现应同步更新或明确取代 ADR-0008 的相关表述。

## Testing Decisions

- 最高优先级测试 seam 是 fake ACP transport 驱动 Kimi ACP Run，并断言输出的归一化 timeline 更新和 terminal 事件。测试只观察外部事件、item 内容、顺序、状态和 transport 行为，不断言私有 Map、计数器或方法调用细节。
- 覆盖连续 thinking chunk 合并、被 message/tool/plan 分隔、再次开始新 phase，以及 completed/cancelled 状态。
- 覆盖连续和不连续 agent message chunk、多个 message segment 的顺序、prompt response 后最后有效 segment 的 `isFinal` 标记，以及控制性消息不成为最终答复。
- 覆盖同一 `toolCallId` 的 start/update 合并、update 先到、不同 id 并行、缺失 id 唯一化、generic tool、shell tool、input/output/error 保留和全部工具状态映射。
- 覆盖 stopReason 的 completed/stopped/failed 映射、取消时 running item 的取消化、已结束 item 不回退、terminal 后迟到事件被忽略、重复 terminal 不重复发布，以及未知 ACP update 被忽略。
- 覆盖 plan 对 Run Checklist 的既有更新、plan 不改变 timeline 顺序、无 plan update 时 Run 仍完成，以及 TodoList 与有效 Checklist 的既有兼容行为。
- 复用现有 Kimi ACP fake transport 测试先例作为 adapter 级测试基础，复用 Chat session manager 的 Run 生命周期测试验证共享 event channel 和其他 Runtime 隔离。
- 为 shared message part/update reducer 增加纯函数测试，验证 Kimi timeline item 的 upsert、稳定顺序、状态更新和重放后的 final message 分离。
- 为 Message Timeline 和 Agent Activity renderer 增加纯函数/组件测试，验证 Thinking 可折叠、默认折叠、tool output/error/status 可见、message segment 保持顺序，以及最终答复不再依赖最后一个 activity index。
- 保留现有其他 Runtime 的测试，并至少运行 Kimi ACP、Chat session manager、message reducer、Message Timeline 和 Agent Activity 相关测试；不以真实 Kimi CLI 作为稳定单元测试依赖。

## Out of Scope

- 不重写整个共享 Chat event 系统或为所有 Runtime 统一引入新的 Agent Loop 模型。
- 不把 ACP 原始事件逐条展示给用户，不展示未知事件的原始 payload。
- 不实现 Codex app-server 的完整事件模型，也不把 Kimi-specific timeline contract 强制推广给其他 Runtime。
- 不在本需求中把 plan 完整展示为 assistant message timeline item；Run Checklist 仍是计划进度的展示位置。
- 不增加第二次模型调用，不发起 summary 请求，也不通过模型生成 Thinking 或最终答复。
- 不改变 Kimi ACP 的 stdio transport、session/new、session/resume、permission、question、file I/O、Carrent Bridge 或 Runtime Session 持久化协议。
- 不提供 child agent 的完整 transcript；Subagent Task 继续遵循现有 best-effort 展示边界。
- 不修改其他 Runtime 的已有 reasoning、shell、delta 或最终答复语义，除非共享类型兼容所必需且有回归测试覆盖。

## Further Notes

- 本 spec 基于 Kimi ACP 的实际事件形态、现有 Kimi ACP V1、Agent Activity、Run Checklist 和 Kimi error propagation 约定整理。
- 时间线的 order 是首次出现顺序，不是 ACP payload 中可能缺失或不稳定的时间戳；这样可以保证实时展示、事件持久化和重放使用同一排序规则。
- Kimi ACP 当前可能把部分 provider failure 伪装为 `end_turn`。本 spec 只要求正确处理协议明确提供的 stopReason，不额外发起 summary 或猜测 provider 内部错误。
- 任何超出本 spec 的 ACP 新事件都必须满足“忽略但不让 parent Run 失败”的既有 Kimi 集成原则。
