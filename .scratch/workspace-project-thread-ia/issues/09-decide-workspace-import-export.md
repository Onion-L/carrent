# 决定 Workspace 导入与导出边界

Type: grilling
Status: closed
Assignee: codex
Blocked by: 05, 07

## Question

Carrent 是否提供 Workspace 导出与导入；若提供，导出物包含哪些 Workspace、Association、Thread、消息、附件、草稿、运行配置、Runtime Session 与 Rewind 数据，如何处理本地 Project Working Directory 路径、已有 Workspace 名称与 Project 身份冲突、缺失目录、版本兼容和敏感数据，并明确导入是恢复原身份、创建副本还是只导入结构？

## Answer

- 目标版本不提供 Workspace 导出、导入、备份或恢复能力，也不定义导出格式、版本兼容、身份与名称冲突、缺失目录、敏感数据或导入身份语义。
- “添加 Project”只选择或复用 Project Working Directory 并建立 Workspace-Project Association，不属于 Workspace 或 Carrent 数据导入。
- 用户手工复制或替换 Carrent app data 不属于受支持的备份、恢复或迁移方式。App State Snapshot 的 schema 兼容边界继续遵循“决定存量数据迁移与兼容边界”。
- 本次只决定目标版本的产品边界，不排除未来另行设计导入导出能力。

## Comments

- 2026-07-26: 确认目标版本不支持 Workspace 导入导出；因此附件、草稿、运行配置、Runtime Session、Rewind 数据与 Project Working Directory 路径等导出内容和导入冲突规则均无需定义。
