# 定义 Workspace、Project、Thread 的领域边界与不变量

Type: grilling
Status: closed
Assignee: codex
Blocked by:

## Question

在 Carrent Desktop App 中，Workspace、Project、Thread 分别代表什么用户可感知对象；三者各自拥有哪些身份、生命周期和上下文；哪些关系必须始终成立？同时明确产品层级 Workspace 与现有“应用持久化快照”“项目目录/cwd”等 workspace 用法应如何区分，并判断当前“Thread 必须 Project-scoped”的词汇定义是否继续成立。

## Answer

- Workspace 是 Carrent 中持久、用户可见的顶层逻辑对象，拥有稳定 ID 和名称，表达长期组织上下文。它不是源码目录、窗口、筛选视图或持久化文件。
- Project 保留现有产品语义：它是拥有稳定 ID 的 Carrent 对象，引用一个本地 Project Working Directory，但不拥有、移动或复制该目录。路径是可更新的定位信息，不是 Project 身份；目录移动、重命名或暂时不可用时，Project 仍是同一对象。目录不要求是 Git 仓库。
- Thread 是 Carrent 自有的持续对话，目标模型中任一时刻必须且只能属于一个 Project。Carrent 拥有并持久化用户可见历史，使 Thread 能跨 Run 和 Runtime 切换保持身份与内容连续性。
- Runtime Session 是某个 Runtime 返回的可替换连续性句柄。Runtime Session ID 与 Carrent 的 Thread ID 分离，不拥有 Thread 身份或用户可见历史；Runtime Session 失效或替换不创建新的 Thread。
- 现有 `WorkspaceSnapshot` 所表达的概念称为 App State Snapshot；Runtime 中表示 cwd 的 `workspace` 概念称为 Project Working Directory。两者都不得作为产品层级 Workspace 的同义词。
- Project 是否可跨 Workspace、同一目录是否可形成多个 Project、Thread 是否可移动，以及 General Chat 的处置，交由“决定三层包含关系与例外项”决定。创建、移除与级联行为交由“决定三层对象的创建、移动与移除语义”决定。
