# 决定各层承载的信息、状态与默认值

Type: grilling
Status: closed
Assignee: codex
Blocked by: 01, 02

## Question

哪些信息和控制属于 Workspace、Project、Thread 各层，包括名称与描述、目录上下文、Runtime 与模型默认值、运行模式、置顶与排序、最近活动、未决状态、搜索范围和用户偏好；哪些值允许从上层继承，哪些必须由 Thread 独立持有，覆盖规则和用户可见来源如何表达？

## Answer

- Workspace 持有稳定 ID、用户可编辑名称和稳定的用户排序。Workspace 不提供置顶、描述、Runtime/模型/运行模式默认值、独立活动状态或独立注意力状态，也不是应用设置作用域。
- Project 持有稳定 ID、共享的用户可编辑名称、当前 Project Working Directory 路径和目录可用状态。名称默认取目录名；共享名称变更对所有关联 Workspace 可见。目录移动后更新 Project，所有关联 Workspace 和现有 Thread 在后续 Run 中使用新路径，其他层不复制路径。
- Workspace-Project Association 持有当前 Workspace 内的可选 Project 别名、稳定排序和“新 Thread 默认运行配置”。它不提供置顶。一个共享 Project 在不同 Workspace 下拥有彼此独立的 Thread 集合。
- 新建 Workspace-Project Association 使用产品固定基线：Primary Runtime（当前为 Kimi）、不指定模型以使用 Runtime 默认模型、Approval Required。Workspace 不提供更上层默认值。
- Thread 持有自动生成且可编辑的标题、置顶状态、最近活动时间、当前 Runtime/模型/运行模式选择、消息历史、草稿、排队消息、附件和最新 Run Checklist。三层均不增加 description 字段。
- Thread 创建时复制 Association 的运行配置，之后完全独立。用户在 Composer 修改配置后，该选择持续用于 Thread 的后续 Run；每个 Run 记录实际使用的配置。修改 Association 只影响之后创建的 Thread，不保留继承链、恢复继承或临时单次覆盖。
- Runtime Session 按 Thread 与 Runtime 关联。Running、等待批准、等待回答、Failed 等 Thread Status 从当前或最近 Run 推导；Workspace 与 Workspace-Project Association 只聚合其下 Thread 的活动和状态，不保存副本。
- Workspace 与 Workspace-Project Association 保持稳定排序，不因活动自动换位。Thread 允许置顶；置顶组和普通组内分别按最近活动排序。
- 搜索范围是界面发起搜索时的临时上下文，不属于领域对象：Project 内搜索只覆盖当前 Workspace-Project Association 的 Thread，Workspace 内搜索覆盖该 Workspace 的 Thread，全局搜索覆盖所有 Workspace。
- 主题、语言、Runtime 可用性、Provider Profile、Local MCP Server、Global Agent Instructions 等用户偏好保持应用级，不复制到 Workspace、Project 或 Thread。Association 界面将配置明确标为“新 Thread 默认配置”，Thread Composer 直接显示当前实际配置，不显示继承来源。
