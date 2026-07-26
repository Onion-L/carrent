# Workspace -> Project -> Thread 三层信息架构重构决策地图

Label: wayfinder:map

## Destination

形成一套完整且互相一致的三层信息架构决策，覆盖领域含义、层级归属、信息职责、导航、生命周期、跨层发现和存量迁移；地图清空后可直接交给 `/to-spec` 综合，无需再补产品级决策。

## Notes

- 范围是 Carrent Desktop App。每次处理决策票前先读 `CONTEXT-MAP.md`、`apps/desktop/CONTEXT.md` 和相关 `docs/adr/`。
- 决策阶段使用 `/grilling` 与 `/domain-modeling`；交互模型需要具体化时使用 `/prototype`。本地图默认只产出决策，不实现代码。
- 当前领域词汇把 Thread 定义为 Project-scoped conversation，但现有产品状态仍包含 projectless General Chat。这是待解决的模型冲突，不是既定方向。
- 当前代码中的 `workspace` 同时指应用级持久化快照、Runtime 的项目目录/cwd；新的产品层级 Workspace 尚未有正式领域定义。在“定义 Workspace、Project、Thread 的领域边界与不变量”解决前，讨论时必须明确所指含义。
- 当前持久化模型是单个隐式 workspace snapshot，包含 Projects、projectless Chats、Messages 与 activeThreadId；当前导航主要使用 `/project/:projectId`、`/thread/:projectId/:threadId` 和 `/chat/:threadId`。
- 一次会话最多解决一张非 Research 决策票。解决结果只写入对应票的 `## Answer`，地图只追加一行摘要链接。

## Decisions so far

- [定义 Workspace、Project、Thread 的领域边界与不变量](./issues/01-define-domain-boundaries.md) — 固定三层对象的独立身份与上下文边界，并将 Carrent Thread 与 Runtime Session、产品 Workspace 与现有 workspace 用法分离。

## Not yet specified

- 三层导航定型后，各主要页面的具体屏幕清单、窗格组合、折叠规则和窄窗口行为。
- 层级职责与跨层发现方式明确后，各层的空状态、首次使用、缺失路径、加载失败和恢复体验。
- 目标数据模型确定后，是否需要 Workspace 导入/导出、复制、模板化或多窗口同时打开，以及这些能力各自的语义。
- 存量迁移策略确定后，版本回退、部分迁移失败、损坏数据和旧 Runtime Session 映射的精确恢复策略。
- 所有产品行为确定后，交给 `/to-spec` 前需要固定的验收行为矩阵与最高层测试边界。

## Out of scope

- 本阶段不实现、重构或删除任何生产代码。
- 不重做 Message Timeline、Composer、Run、Agent Activity 等 Thread 内部体验；仅允许后续规格定义它们需要展示的层级上下文。
- 不改变 Runtime 或 Agent Loop 协议，除非三层归属决策要求现有请求携带必要的层级标识。
- 不包含云同步、多人协作、账号与权限系统、远程项目管理。
- 不包含 Landing 站点或移动端信息架构。
