# 决定各层空状态、缺失与恢复体验

Type: prototype
Status: closed
Assignee: codex
Blocked by: 03, 04, 05, 06

## Question

在三层职责、导航、生命周期和跨层发现方式已经固定的基础上，用低保真原型决定 Workspace、Project、Thread、待处理和搜索的首次使用与空状态，以及 Project Working Directory 不可用、路由目标缺失、加载失败和已保存导航位置无法恢复时分别显示什么上下文、提供哪些恢复动作、恢复成功后落到哪里；不得重新讨论存量数据迁移失败、损坏数据或旧 Runtime Session 映射的兼容策略。

## Answer

- 采用原型 A 的 Local replacement 模型：状态替换能够准确归属问题的最小内容面，仍有效的 Workspace 切换栏、Project/Thread 分组导航和层级路径保持可见；不为状态新增独立路由、模态恢复流程或全局 Recovery Center。
- 应用没有 Workspace 时显示全局首次使用空状态：Workspace 切换栏保留 Carrent、创建 Workspace 和设置入口，内容区只显示 Workspace 名称输入与“创建 Workspace”。创建成功后进入新 Workspace 概览。
- 空 Workspace 是合法常态。中栏不显示 Project 分组，Workspace 概览显示“添加 Project”主动作并说明 Carrent 不移动或复制所选目录；添加成功后进入对应 Project 概览。已存在的 Association 仍按生命周期决策直接打开，不制造空状态。
- 空 Project 在 Project 概览显示“新建 Thread”主动作。点击后打开该 Workspace-Project Association 的 Thread Draft；发送前不创建 Thread，Draft 显示当前实际运行配置并允许丢弃。首次发送成功时原子创建 Thread 并停留在新 Thread 内容页。由于 Thread 只在首次发送时创建，产品不存在独立的“空 Thread”页面或零消息 Thread 空状态。
- 「待处理」没有条目时，只在临时替换中栏的待处理列表区域显示“当前没有需要处理的 Thread”，并说明批准请求、等待回答和 Failed Thread 会出现在这里；右侧原有 Workspace、Project 或 Thread 内容保持不变，不自动跳转，也不提供多余的恢复按钮。用户点击 Workspace 或正常导航项退出待处理视图。
- 搜索首次打开且查询为空时，继续按既定规则显示当前范围内最多 20 个最近活动 Thread；当前范围没有活跃 Thread 时在结果区显示范围明确的空状态，并提供切换范围。查询无匹配时保留查询文本和范围，提供“清除搜索”和切换范围；清除后回到最近活动列表。搜索空状态不提供创建 Thread，打开结果后的落点和历史行为沿用跨层发现决策。
- Project Working Directory 不可用时，在 Project 项显示警告标识，并用就地错误状态替换当前右侧 Project 或 Thread 内容面；仍有效的层级导航和完整路径保持可见。状态显示记录路径，说明历史仍保留但不能启动新 Run，并提供“再次检查”和“重新定位目录”。检查恢复或重新定位成功后返回触发错误前的 Project/Thread 位置，以 replace 恢复而不新增浏览历史；取消、校验失败或更新失败均留在原状态。重新定位后的 Runtime Session 与 Rewind 行为沿用生命周期决策。
- 路由目标缺失时不显示独立错误页，直接按既定层级回退到最近仍有效的上级：Thread 缺失进入 Project 概览、Project 缺失进入 Workspace 概览、Workspace 缺失进入 Workspace 选择页。回退页面保留正常操作，并显示一次可关闭的非阻塞提示，包含缺失层级和目标名称；不提供重新创建同一身份的动作。该回退替换当前位置，不新增浏览历史。
- 目标身份与归属仍有效但内容加载失败时，只替换右侧目标内容面，保留可解析的导航、层级路径和目标名称。提供“重试”和“打开上级概览”；重试成功后回到原目标并替换当前位置，失败则保持错误状态；用户主动打开上级概览属于显式导航并进入浏览历史。提示只声明数据暂时无法读取以及项目文件未被修改，不把加载失败表述为数据损坏。
- 应用重启时已保存导航位置无法恢复，继续使用导航决策的回退顺序：Workspace 仍有效则进入其概览；Workspace 也失效则进入稳定排序第一个 Workspace 概览；没有 Workspace 则进入全局首次使用空状态。除全局空状态外显示一次可关闭的非阻塞提示，说明已打开的有效位置；恢复和回退均替换当前位置，不新增浏览历史，也不在后续启动重复提示同一次失效。
- 本票只定义正常空状态、暂时不可用与可重试加载失败；存量迁移失败、持久化损坏、未知 schema 和旧 Runtime Session 映射继续由各自决策处理，不复用本票文案或恢复动作。

## Comments

- 2026-07-26: HITL 评审选择 A（Local replacement），状态替换最小受影响内容面并保留仍有效的层级上下文。
- 2026-07-26: 交互原型归档在本地分支 `codex/prototype-empty-recovery-states`，最终提交 `2759fcd`，入口为 `apps/desktop/src/renderer/routes/EmptyRecoveryPrototypePage.tsx`。
