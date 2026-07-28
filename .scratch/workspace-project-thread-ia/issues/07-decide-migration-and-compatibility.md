# 决定存量数据迁移与兼容边界

Type: grilling
Status: closed
Assignee: codex
Blocked by: 02, 03, 04, 05

## Question

现有单一 workspace snapshot 中的 Projects、projectless Chats、Messages、activeThreadId、Thread Work、附件与 Runtime Session 映射如何迁移到目标三层模型；旧路由与深链接如何处理；升级后如何保证身份稳定、历史不丢、运行上下文不串层，并明确必须兼容的旧版本范围和允许中止迁移的条件？

## Answer

- Carrent 尚未正式发布，三层模型采用全新 schema，不迁移或兼容旧 App State Snapshot。已知旧开发版中的 Projects、projectless Chats、Messages、`activeThreadId`、Thread Work、附件和 Runtime Session 映射全部重置，不承诺保留旧身份或历史。
- 检测到明确识别的旧开发版 schema 时，自动执行一次无备份、无确认的重置；成功后创建空的三层状态并显示一次提示，不提供旧数据恢复入口。
- 清理范围只包括 Carrent app data：旧 App State Snapshot、Runtime Session 映射、附件存储和 projectless chat 内部目录。不得扫描或修改 Project Working Directory、项目文件或 Git 状态。
- 任一必要清理或新状态写入失败时中止数据层初始化，不允许在半旧半新的状态下继续运行。
- 不兼容旧路由 `/project/:projectId`、`/thread/:projectId/:threadId` 和 `/chat/:threadId`，也不转换旧 ID。旧路由统一回退到新的 Workspace 选择页，并显示一次来自不兼容旧版本的非阻塞提示。
- 新模型的 Runtime Session 映射键固定为 `Runtime ID + Thread ID`，不包含 Workspace ID、Project ID 或 Project Working Directory 路径。Thread ID 全局唯一且归属不可变；Project 重新定位时解除该 Project 下全部 Runtime Session。
- 自动重置只适用于明确识别的旧开发版 schema。目标版本只读取显式支持的 schema；遇到未知的更旧或更新版本时保留原文件、阻止数据层启动并提示升级或使用匹配版本，绝不自动清空。未来需要兼容时必须显式增加迁移器。

## Comments

- 2026-07-26: Carrent 尚未正式发布且只有开发者本人使用；三层模型落地时允许清空旧版本本地数据，不要求迁移旧 App State Snapshot、projectless Chats、Messages、Thread Work、附件或 Runtime Session 映射，也不承诺旧版本数据兼容。
- 2026-07-26: 不兼容旧路由 `/project/:projectId`、`/thread/:projectId/:threadId` 和 `/chat/:threadId`，也不做旧 ID 到新层级路径的转换；旧路由统一回退到新的 Workspace 选择页，并显示一次不兼容提示。
- 2026-07-26: 旧数据清理只作用于 Carrent 的 app data，包括旧 App State Snapshot、Runtime Session 映射、附件存储和 projectless chat 内部目录；不扫描或修改 Project Working Directory、项目文件或 Git 状态。
- 2026-07-26: 新模型中的 Runtime Session 映射键固定为 `Runtime ID + Thread ID`，不包含 Workspace ID、Project ID 或 Project Working Directory 路径。Thread ID 全局唯一且归属不可变；Project 重新定位时按生命周期决策解除该 Project 下全部 Runtime Session。
- 2026-07-26: 检测到已知旧 schema 时自动执行一次无备份、无确认的重置；清理成功后创建新的空三层状态并显示一次提示。任一必要清理或新状态写入失败时中止初始化，不允许以半旧半新的状态继续运行，也不提供旧数据恢复入口。
- 2026-07-26: 自动重置只适用于当前明确识别的旧开发版 schema。目标版本只读取显式支持的 schema；遇到未知的更旧或更新版本时保留原文件、阻止数据层启动并提示使用匹配版本或升级，绝不自动清空。后续版本需要兼容时必须显式增加迁移器。
