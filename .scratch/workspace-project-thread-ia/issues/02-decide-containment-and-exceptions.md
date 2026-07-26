# 决定三层包含关系与例外项

Type: grilling
Status: closed
Assignee: codex
Blocked by: 01

## Question

Workspace、Project、Thread 之间采用怎样的包含与归属规则：一个 Project 能否属于多个 Workspace，一个目录能否形成多个 Project，一个 Thread 能否脱离 Project、跨 Project 或被移动；General Chat 在目标模型中应保留为例外、归入特殊 Project，还是转化为其他对象？为每种允许和禁止的关系给出明确场景与不变量。

## Answer

- Workspace 与 Project 是多对多关联，不是所有权关系。一个 Workspace 可关联零个或多个 Project；一个 Project 在稳定状态下必须关联一个或多个 Workspace。同一 Project 可同时被多个 Workspace 使用，Carrent 不因并发修改风险限制这种关联。
- Workspace 是扁平顶层对象，不允许嵌套其他 Workspace。空 Workspace 是有效状态，用户可以先建立工作上下文，再逐步导入 Project。
- 同一个 Project Working Directory 在 Carrent 中复用同一个 Project。用户将它再次导入其他 Workspace 时，Carrent 建立新的 Workspace-Project 关联，而不创建重复 Project。
- 不同路径下的目录是不同的 Project Working Directory，即使它们来自同一个 Git repository 或 remote，也允许分别创建 Project。Carrent 不复制、移动或拥有这些目录。
- Thread 创建时必须同时归属于恰好一个 Workspace 和恰好一个 Project，且该 Project 必须已关联该 Workspace。同一 Project 在不同 Workspace 下拥有各自独立的 Thread 集合。
- Thread 的 Workspace 与 Project 归属创建后不可更改。Thread 不能脱离 Project、跨 Project 移动，也不能在关联同一 Project 的 Workspace 之间移动。跨层搜索或展示不改变归属。
- 目标模型不再允许创建 projectless General Chat，也不通过无目录的特殊 Project 保留该例外。现有 General Chat 的迁移、只读保留或其他兼容方式由“决定存量数据迁移与兼容边界”处理。
