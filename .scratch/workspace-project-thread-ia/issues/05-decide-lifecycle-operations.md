# 决定三层对象的创建、移动与移除语义

Type: grilling
Status: closed
Assignee: codex
Blocked by: 01, 02

## Question

Workspace、Project、Thread 分别如何创建、加入、重命名、复制或移动、归档、移除和删除；这些操作对消息历史、附件、草稿、运行中 Run、Runtime Session、项目文件与下一个选中项有什么影响；哪些操作可逆、需要确认、必须阻止，哪些只是从层级中解除关联而不是删除数据？

## Answer

- Workspace 创建时要求应用内不区分大小写且唯一的非空名称。新 Workspace 是合法空对象，追加到稳定排序末尾并立即打开概览；不提供创建向导、模板、复制或嵌套。
- Workspace 只有一个“添加 Project”入口。用户选择 Project Working Directory 后，首次出现则原子创建 Project 与 Association；已有 Project 则复用并新增 Association；当前 Workspace 已有关联时直接打开，不创建重复项。
- 每个 Workspace-Project Association 最多有一个可恢复的 Thread Draft。它不是 Thread，但固定作用于该 Association，持久化未发送内容、附件与运行配置，不进入 Thread 列表、搜索、最近访问或归档；首次发送时创建归属同一 Workspace 与 Project 的 Thread。移除 Association 或删除 Workspace 时可直接丢弃草稿及未发送附件，不构成阻塞。
- Workspace 与 Thread 重命名直接修改自身名称或标题。Workspace 内的 Project 内联重命名只修改 Association 显示别名，清空别名后恢复共享 Project 名称；全局 Project 名称只在 Project 设置中修改，并提示会影响全部关联 Workspace。
- 不提供 Workspace、Project 或 Thread 复制，不允许 Thread 跨 Workspace 或 Project 移动。向其他 Workspace 添加已有 Project 只创建 Association；Carrent 永不复制、移动或删除 Project Working Directory。
- Project Working Directory 只允许用户主动“重新定位目录”；Carrent 只检测当前路径是否可用，不扫描或猜测新位置。重新定位要求 Project 无活跃 Run 且目标目录未绑定其他 Project；成功后保留 Thread 及 Carrent 历史数据，解除该 Project 的全部 Runtime Session；任一失败保持原路径与状态。
- 只有 Thread 支持归档。归档是无损冻结：保留身份、标题、历史、附件、草稿、运行配置、Runtime Session 与置顶状态，禁止新 Run；只有空闲且无排队消息的 Thread 可归档。归档和取消归档不改变 Thread Activity Time，取消后回到原 Workspace 与 Project。
- 所有 Archived Thread 统一在设置页归档区域管理，可取消归档或永久删除。活跃 Thread 只提供归档；单个 Thread 的永久删除只能从归档区域发起并要求普通确认。
- 永久删除 Thread 会原子清理身份、消息、附件快照、草稿、排队数据、Run Checklist 和 Runtime Session 映射；失败则保留原状态。它不撤销 Run Changes，不修改项目文件、Git 分支、提交、索引或 stash。
- 移除 Workspace-Project Association 会在普通确认后永久删除该组合下全部 Thread 与 Thread Draft。删除 Workspace 会在普通确认后永久删除其作用域内全部 Thread、Thread Draft 与 Association。任一受影响 Thread 有活跃 Run 时阻止；共享 Project 在其他 Workspace 的 Association 与 Thread 不受影响。
- 不提供全局删除 Project。Project 的最后一个 Association 被移除时自动移除其 Carrent 记录，Project Working Directory 始终保留。
- 活跃 Run 期间允许重命名 Workspace、Project、Association 别名与 Thread，并允许调整置顶；禁止归档对应 Thread，也禁止重新定位同一 Project。创建 Workspace、添加 Association 和操作其他 Project 不受影响。
- 归档当前 Thread 后选择同一 Project 排序后的下一条活跃 Thread，无则进入 Project 概览，不跨 Project 自动选择。取消归档留在设置页并提供打开入口；永久删除后留在归档区域并选择下一项。移除 Association 后进入 Workspace 概览；删除 Workspace 后选择排序中的下一项、无则前一项，全部删除后进入全局空状态。
- 归档、取消归档、重命名和置顶无需确认。永久删除 Archived Thread、移除 Association、删除 Workspace 使用普通确认弹窗，不要求输入名称；级联弹窗显示 Thread 数量并说明磁盘目录和其他 Workspace 不受影响。重新定位显示旧路径与新路径。所有永久删除与级联删除必须原子完成，活跃 Run 阻塞在弹窗前检查。

## Comments

- 2026-07-26: 仅 Thread 支持归档与恢复；Workspace、Project 和 Workspace-Project Association 不引入归档状态。
- 2026-07-26: 活跃 Thread 的单项操作只提供归档；单个 Thread 的永久删除只允许从设置页统一归档区域执行并要求确认，Workspace 或 Association 的确认级联删除除外。该区域列出所有 Archived Thread，同时提供取消归档。
- 2026-07-26: Thread 归档采用无损冻结语义，保留身份、标题、历史、附件、草稿、运行配置、Runtime Session 与置顶状态；归档和取消归档不改变 Thread Activity Time。仅空闲且无排队消息的 Thread 可归档，归档后禁止 Run，取消归档后回到原 Workspace 与 Project。
- 2026-07-26: 移除 Workspace-Project Association 会在普通确认弹窗后级联永久删除该组合下全部 Thread 与 Thread Draft；删除 Workspace 同样级联永久删除其作用域内全部 Thread、Thread Draft 与 Association。任一受影响 Thread 有活跃 Run 时阻止。共享 Project 在其他 Workspace 的 Association 与 Thread 不受影响；失去最后一个 Association 的 Project 记录同时移除，Project Working Directory 始终不受影响。
- 2026-07-26: Workspace 只提供一个“添加 Project”入口。选择目录后，首次出现则原子创建 Project 与 Association；已有 Project 则复用并创建 Association；当前 Workspace 已有关联时不重复创建，直接打开现有 Project。
- 2026-07-26: 创建 Workspace 时要求输入应用内不区分大小写且唯一的非空名称；创建后得到合法的空 Workspace，追加到稳定排序末尾并进入其概览页。不提供创建向导、模板或复制入口。
- 2026-07-26: 每个 Workspace-Project Association 最多保留一个可恢复的 Thread Draft。它不是 Thread，但固定作用于该 Association，持久化未发送内容、附件和运行配置，不进入 Thread 列表、搜索、最近访问或归档区域；首次发送时生成归属同一 Workspace 与 Project 的正式 Thread，父级移除时可直接丢弃。
- 2026-07-26: Workspace 内的 Project 内联重命名只修改当前 Association 的显示别名；清空别名恢复共享 Project 名称。全局 Project 名称只在 Project 设置中修改，并明确提示会影响所有关联 Workspace。Workspace 与 Thread 的重命名直接修改自身名称或标题。
- 2026-07-26: 不提供 Workspace、Project 或 Thread 复制。向其他 Workspace 添加已有 Project 只创建 Association；Carrent 不复制或移动 Project Working Directory。目录被外部移动后通过重新定位更新同一 Project，所有 Association 与 Thread 的后续 Run 使用新路径。Thread 仍禁止跨 Workspace 或 Project 移动。
- 2026-07-26: 永久删除 Archived Thread 会原子清理 Thread 身份、消息、附件快照、草稿、排队数据、Run Checklist 和 Runtime Session 映射；任一清理失败则保留完整 Archived Thread。它不撤销 Run Changes，不修改项目文件或普通 Git 状态。确认框显示完整层级路径并明确项目文件不会被撤销。
- 2026-07-26: 活跃 Run 期间允许重命名 Workspace、Project、Association 别名与 Thread，并允许调整置顶；禁止归档运行中、等待批准或等待回答的 Thread。同一 Project 任一 Thread 有活跃 Run 时，禁止重新定位其目录。创建 Workspace、添加 Association 和操作其他 Project 不受影响。
- 2026-07-26: 归档当前 Thread 后选择同一 Project 排序后的下一条活跃 Thread，无则进入 Project 概览；不跨 Project 自动选择。取消归档留在设置页归档区域并提供打开入口；永久删除后留在归档区域并选择下一项。移除 Association 后进入 Workspace 概览。删除 Workspace 后选择排序中的下一项、无则前一项，全部删除后进入全局创建 Workspace 空状态。
- 2026-07-26: Project Working Directory 的路径更新只能由用户主动执行“重新定位目录”并选择新目录。Carrent 只检测已记录路径是否可用，不扫描磁盘、不猜测新位置，也不自动修改路径。
- 2026-07-26: 手动重新定位要求 Project 无活跃 Run 且目标目录未绑定其他 Project。成功后保留 Thread、消息、附件、草稿和运行配置，解除该 Project 的全部 Runtime Session。任一校验或更新失败时原路径与状态不变。
- 2026-07-26: 不提供全局删除 Project。用户只能逐个移除 Workspace-Project Association；最后一个 Association 被移除时自动移除 Carrent 的 Project 记录。Project Working Directory 始终不受影响。
- 2026-07-26: Thread Draft 继续按 Workspace-Project Association 隔离，避免同一 Project 在不同 Workspace 的草稿混用。它不阻止移除 Association 或删除 Workspace；父级操作直接丢弃对应草稿及尚未进入消息历史的附件快照。
- 2026-07-26: 删除 Workspace 不要求输入名称确认，只使用明确说明级联范围的普通确认弹窗；整个删除必须原子成功，否则 Workspace 及其内容保持不变。
