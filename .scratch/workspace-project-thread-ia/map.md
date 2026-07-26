# Workspace -> Project -> Thread 三层信息架构重构决策地图

Label: wayfinder:map

## Destination

形成一套完整且互相一致的三层信息架构决策，覆盖领域含义、层级归属、信息职责、导航、生命周期、跨层发现和存量迁移；地图清空后可直接交给 `/to-spec` 综合，无需再补产品级决策。

## Notes

- 范围是 Carrent Desktop App。每次处理决策票前先读 `CONTEXT-MAP.md`、`apps/desktop/CONTEXT.md` 和相关 `docs/adr/`。
- 决策阶段使用 `/grilling` 与 `/domain-modeling`；交互模型需要具体化时使用 `/prototype`。本地图默认只产出决策，不实现代码。
- 当前持久化模型是单个隐式 workspace snapshot，包含 Projects、projectless Chats、Messages 与 activeThreadId；当前导航主要使用 `/project/:projectId`、`/thread/:projectId/:threadId` 和 `/chat/:threadId`。
- 一次会话最多解决一张非 Research 决策票。解决结果只写入对应票的 `## Answer`，地图只追加一行摘要链接。

## Decisions so far

- [定义 Workspace、Project、Thread 的领域边界与不变量](./issues/01-define-domain-boundaries.md) — 固定三层对象的独立身份与上下文边界，并将 Carrent Thread 与 Runtime Session、产品 Workspace 与现有 workspace 用法分离。
- [决定三层包含关系与例外项](./issues/02-decide-containment-and-exceptions.md) — Workspace 与 Project 采用多对多关联，Thread 固定归属一个 Workspace-Project 组合，目标模型取消 projectless General Chat。
- [决定各层承载的信息、状态与默认值](./issues/03-assign-level-responsibilities.md) — 固定三层及 Workspace-Project Association 的信息职责，以 Thread/Run 作为状态来源，并采用 Association 初始化、Thread 固化的运行配置规则。
- [用低保真原型决定三层导航模型](./issues/04-prototype-navigation-model.md) — 采用 Workspace 切换栏、当前 Workspace 的 Project/Thread 分组导航与内容区三栏模型，并固定位置恢复、历史和深链接回退规则。
- [决定三层对象的创建、移动与移除语义](./issues/05-decide-lifecycle-operations.md) — 固定创建与重命名入口、Thread Draft 与归档规则、级联删除边界、目录重新定位及运行中阻塞和删除后落点。
- [决定跨层发现与注意力管理](./issues/06-decide-cross-level-discovery.md) — 采用全局待处理与分层标题搜索，Running 和置顶留在 Thread 所属 Project 分组，并固定排序、路径和跨 Workspace 跳转规则。
- [决定存量数据迁移与兼容边界](./issues/07-decide-migration-and-compatibility.md) — 未发布阶段采用已知旧 schema 的受限自动重置，不兼容旧数据与路由，并固定未知版本保护和 Runtime Session 隔离规则。
- [决定主要屏幕、窗格组合与窄窗口行为](./issues/08-decide-screen-and-pane-behavior.md) — 复用现有三栏 DesktopShell、尺寸和手动折叠规则，仅替换三层导航语义，不增加自动响应式降级。
- [决定 Workspace 导入与导出边界](./issues/09-decide-workspace-import-export.md) — 目标版本不提供 Workspace 导入、导出、备份或恢复能力，手工复制 app data 也不属于受支持路径。
- [决定 Workspace 多窗口打开语义](./issues/10-decide-multi-window-semantics.md) — 目标版本采用唯一 Main Window，固定重复启动、深链接、设置、退出和重启恢复规则，并排除跨窗口状态与 Run 控制冲突。
- [决定各层空状态、缺失与恢复体验](./issues/11-decide-empty-missing-and-recovery-states.md) — 采用状态就地替换并保留有效层级上下文，固定首次使用、空结果、目录不可用、目标缺失、加载失败与位置恢复的动作和落点。
- [决定三层持久化损坏与版本不匹配的恢复体验](./issues/12-decide-persistence-corruption-recovery.md) — 按 App State、Runtime Session 与附件隔离故障，固定全局阻塞、局部降级、诊断、重试与完整重置边界。

## Not yet specified

- 无。

## Out of scope

- 本阶段不实现、重构或删除任何生产代码。
- 不重做 Message Timeline、Composer、Run、Agent Activity 等 Thread 内部体验；仅允许后续规格定义它们需要展示的层级上下文。
- 不改变 Runtime 或 Agent Loop 协议，除非三层归属决策要求现有请求携带必要的层级标识。
- 不包含云同步、多人协作、账号与权限系统、远程项目管理。
- 不包含 Landing 站点或移动端信息架构。
