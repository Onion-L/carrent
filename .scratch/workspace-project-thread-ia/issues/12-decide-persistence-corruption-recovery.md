# 决定三层持久化损坏与版本不匹配的恢复体验

Type: grilling
Status: closed
Assignee: codex
Blocked by: 07, 09

## Question

目标三层 schema 投入使用后，如果显式支持版本的 App State Snapshot、Runtime Session 映射或附件数据出现缺失、部分写入、格式损坏或引用不一致，Carrent 应阻止哪些能力、允许哪些只读访问，并向用户提供重试、导出、导入、移除 Runtime Session、丢弃孤立附件或完整重置中的哪些恢复动作；同时明确遇到未知更旧或更新 schema 时的阻塞界面、诊断信息和恢复后落点，不得重新引入对当前旧开发版数据的迁移承诺。

## Answer

- 恢复采用按故障归属隔离的原则。只有无法完整验证 App State Snapshot 时才阻止整个数据层；Runtime Session 映射或附件的局部故障不得拖垮其他 Thread、其他附件或整个 App。
- App State Snapshot 出现缺失、部分写入、格式损坏或 Workspace、Project、Association、Thread 等内部引用不一致时，不展示或继续使用部分可解析的数据，阻止正常导航、Run 和任何数据写入。Main Window 显示全局阻塞状态，只提供“重新读取”“复制诊断信息”和“完整重置”；不提供导出、导入、局部修复或从残缺状态自动补全。
- “重新读取”重新验证原数据。成功后在当前 Main Window 恢复正常 App，并尝试恢复已保存位置；位置无效时沿用既定导航回退规则。该恢复替换当前位置，不新增浏览历史。
- “完整重置”是用户主动选择的危险操作，二次确认必须明确它会永久删除全部 Carrent app data，但不会扫描或修改 Project Working Directory、项目文件或 Git 状态。成功后创建空的三层状态，进入全局首次使用空状态，并显示一次“本地数据已重置”提示；失败则继续停留在阻塞状态，保留原错误并追加重置失败信息，不进入半初始化状态。成功恢复不要求用户手动重启 App。
- Runtime Session 映射缺失视为没有可恢复的旧 Session，下次 Run 创建新 Session，不视为持久化损坏。Carrent 在 Run 前发现单条映射格式无效或引用不一致时，只解除受影响映射，保留 Thread 历史并允许后续 Run，同时显示一次非阻塞提示。
- Runtime 拒绝恢复映射指向的 Session 或报告 Session 不存在时，本次 Run 失败且不得静默重试，Thread 提供“移除 Runtime Session 并重试”。该动作只影响对应 Runtime 与 Thread 的映射，不影响其他 Thread，也不触发完整重置。
- 已发送消息引用的附件缺失、损坏或无法读取时，消息与 Thread 历史继续显示，附件位置标记为“文件不可用”；该附件不可预览、读取或传给 Runtime，也不得退回读取原始来源路径，但不阻止 Thread 的后续 Run。Thread Draft 引用不可用附件时阻止发送，直到用户移除或重新添加该附件。
- App State Snapshot 有效时，附件存储中没有被任何消息或 Thread Draft 引用的孤立文件可以自动删除，不需要单独恢复界面。单个附件故障不阻止整个 Thread 或 App，也不触发完整重置。
- 诊断信息可以包含 Carrent 应用版本、故障数据区域、失败阶段、错误摘要、数据文件路径、发生时间，以及可识别的 Workspace、Project、Thread、Runtime 或附件 ID；不得复制完整 App State、消息正文、Thread Draft 内容、附件内容、Provider 配置或其他可能含敏感信息的数据。
- 当前项目尚未发布，本票不继续设计新旧发布版本之间的恢复体验。未知 schema 只沿用“决定存量数据迁移与兼容边界”：保留原文件、阻止数据层启动且不自动清空；本票不新增迁移、导入、导出或版本恢复承诺。

## Comments

- 2026-07-27: 确认按 App State Snapshot、Runtime Session 映射和附件三类故障分别隔离；只在主状态无法完整验证时全局阻塞，局部故障保留其余可用历史与 Run 能力。
- 2026-07-27: 确认主状态阻塞页只提供重新读取、复制诊断信息和经二次确认的完整重置；重置成功进入首次使用空状态，失败不得进入半初始化状态。
- 2026-07-27: 确认 Runtime Session 映射可独立解除，历史不受影响；附件故障按历史附件、Draft 附件和孤立文件分别降级、阻止发送或自动清理。
- 2026-07-27: 当前未发布阶段不继续设计新旧版本恢复体验，未知 schema 仅沿用既有兼容边界。
