# Carrent V1 PRD

- Date: 2026-04-23
- Status: Draft
- Scope: V1
- Product: Carrent

## 1. 产品定位

Carrent V1 是一个面向本地代码项目的 agent chat workspace。

它不是任务管理器，不是自动调度平台，也不是通用模型聊天工具。V1 的核心能力是：

- 用户在某个本地 project/repo 中工作
- 用户在 GUI 中选择自己定义的 agent 发起对话
- agent 使用自己绑定的本地 CLI/runtime 执行
- 用户可以在同一个 thread 中切换不同 agent，延续同一段上下文

产品目标不是替用户定义最佳协作方法，而是先提供一个稳定、清晰、可持续使用的本地工作台。

## 2. 目标用户

V1 的核心用户是独立开发者。

典型特征：

- 同时维护多个本地项目
- 已经习惯基于终端和本地 CLI 工作
- 会持续复用不同职责的 AI 助手
- 不想每次都重新写 prompt、重新找目录、重新组织上下文

## 3. 核心问题

当前本地 CLI 工作流的问题不是“不能和模型聊天”，而是以下体验长期割裂：

- 不同职责的 prompt 无法稳定复用
- 同一个项目中的上下文和历史线程分散
- 想换一个 agent 视角时，需要重新组织上下文
- 本地 CLI 的使用是一次性的，不像一个可持续工作的 workspace

V1 需要先解决的问题是：

`让用户在本地项目上下文中，用一个持续可用的 GUI 工作台，稳定地调用不同职责的 agent。`

## 4. V1 产品定义

V1 的核心产品模型如下：

- `Project`
  - 一个本地目录或 repo
  - 是 thread 和执行上下文的边界
- `Agent`
  - 用户全局定义的角色
  - 包含名称、职责定义、默认 runtime
- `Runtime`
  - 用户本地可用的 CLI 执行入口
  - 例如本地已安装且可被调用的模型 CLI
- `Thread`
  - 某个 project 下的一段连续工作会话
  - 由用户手动创建
- `Message`
  - 发生在某个 thread 中的一条消息
  - 每条消息都对应一个明确的 agent
- `Run`
  - 一次真实的 runtime 执行
  - 由用户在某个 thread 中向某个 agent 发送消息触发

## 5. V1 目标

V1 必须做到以下几点：

1. 用户可以接入多个本地 project，并在它们之间切换
2. 用户可以创建多个全局 agent，并为每个 agent 绑定职责和默认 runtime
3. 用户可以在某个 project 下创建 thread，选择 agent 发起聊天
4. 用户可以在同一个 thread 中切换到另一个 agent，继续同一段上下文
5. 用户可以看到当前 project 下的 thread history，并持续回到旧线程继续工作
6. 当 runtime、agent 配置或 project 路径有问题时，系统能明确告诉用户原因

## 6. V1 非目标

V1 明确不做以下内容：

- 任务系统
- 任务状态流转
- 看板
- Inbox
- agent 自动拆任务
- agent-to-agent 直接通信
- 多 agent 调度编排
- 子任务体系
- 自动执行链路
- review 工作流
- 团队协作
- 云端同步
- 权限系统
- 跨 project 联动

V1 只做一件事：把本地 CLI 使用方式，沉淀成一个以 project 为上下文、以 agent 为交互对象的 chat workspace。

## 7. 核心原则

### 7.1 Product Principle

- 产品尽量小
- 不提前引入还没有成立的协同概念
- 不替用户规定唯一工作流
- 不对用户的 agent 分工方法负责

### 7.2 Interaction Principle

- 主工作区永远是 chat
- 其他页面都是支撑页
- project 是上下文边界，不是复杂管理后台
- agent 是长期资产，不是一次性 prompt

### 7.3 Scope Principle

- 先把 `project + thread + agent + runtime` 做稳
- 任务、调度、协同能力后续自然演进，不在 V1 强塞

## 8. 对象模型

### 8.1 Project

定义：

- 一个本地目录 / repo
- 用户进入某个 project，等于在这个目录上下文中开始工作

规则：

- thread 按 project 隔离
- 左侧 history list 只显示当前 project 下的 threads
- 切换 project 等于切换工作上下文

### 8.2 Agent

定义：

- 全局定义，可在多个 project 中复用

最小字段：

- `name`
- `responsibility_prompt`
- `default_runtime`

规则：

- 不提供预设 agent
- 不提供临时 agent 模板
- agent 的职责完全由用户决定

### 8.3 Runtime

定义：

- 用户本地可用的 CLI 执行入口

V1 要求：

- 能检测本地可用 runtime
- 能展示检测状态
- 能给 agent 绑定默认 runtime

最小展示信息：

- runtime 名称
- 检测状态
- 可执行路径
- 基础版本信息
- 是否可绑定

### 8.4 Thread

定义：

- project 下的一段聊天工作会话

规则：

- 只能用户手动创建
- 一个 thread 中允许中途切换 agent
- thread 不与 task 强绑定
- thread 的主要作用是承载上下文和历史

### 8.5 Message

规则：

- 每条消息都发生在某个 thread 中
- 每条消息都必须有明确 agent 归属
- 没有选中 agent 时不能发送消息

### 8.6 Run

定义：

- 一次实际的 runtime 调用

规则：

- 在当前 project 路径中执行
- 由当前选中的 agent 触发
- 输出回写到当前 thread

## 9. 信息架构

V1 保留 4 个一级模块：

1. `Chat`
2. `Agents`
3. `Runtimes`
4. `Settings`

说明：

- `Chat` 是默认主入口
- `Agents` 和 `Runtimes` 是支撑页
- `Settings` 只保留必要全局配置
- `Projects` 不单独做成一级页面，先作为 `Chat` 内的上下文切换入口

## 10. 页面结构

### 10.1 Chat Workspace

这是 V1 默认页面，也是主工作区。

结构：

- 左侧：当前 project 下的 `thread history list`
- 中间：当前 thread 的聊天时间线
- 底部：输入框、agent 选择器、发送动作
- 顶部：当前 project 信息与切换入口

关键规则：

- `New Thread` 由用户手动触发
- 切换 agent 不会新建 thread
- 同一个 thread 中，不同 agent 的消息按时间线混合展示
- 每条消息必须清楚标出来自哪个 agent

### 10.2 Agents

用于管理全局 agent。

功能：

- agent 列表
- 创建 agent
- 编辑 agent
- 删除 agent

单个 agent 的最小配置：

- `Name`
- `Responsibility Prompt`
- `Default Runtime`

### 10.3 Runtimes

用于展示和检测本地 CLI/runtime。

功能：

- 检测本地可用 runtime
- 展示状态
- 展示路径与版本信息
- 作为 agent 绑定 runtime 的来源页

### 10.4 Settings

V1 只放必要设置，不做大面板。

优先保留：

- 本地数据目录或缓存信息
- 默认 project 恢复策略
- 基础运行偏好

## 11. 核心交互流程

### 11.1 First-Time Flow

1. 用户打开应用
2. 接入或选择一个本地 project
3. 如果没有 agent，先去 `Agents` 创建
4. 如果没有可用 runtime，去 `Runtimes` 检测和配置
5. 返回 `Chat`
6. 用户手动新建 thread
7. 选择一个 agent
8. 开始聊天

### 11.2 Normal Flow

1. 用户进入某个 project
2. 左侧看到该 project 下的历史 threads
3. 进入旧 thread 或新建 thread
4. 选择 agent
5. 发送消息
6. 系统在当前 project 目录中调用该 agent 绑定的 runtime
7. 输出回写到当前 thread
8. 用户继续追问，或切换到另一个 agent
9. 新 agent 默认拿到该 thread 的完整历史

### 11.3 Agent Switching Flow

1. 用户在当前 thread 中切换 agent
2. 系统明确显示当前选中的 agent 已变化
3. 用户发送下一条消息
4. 新 agent 以该 thread 完整历史作为上下文继续执行

## 12. 关键交互规则

### 12.1 Project Rules

- 当前工作始终基于某个 project
- history list 只显示当前 project 下的 threads
- project 不可访问时，阻止继续执行并提示修复

### 12.2 Thread Rules

- thread 只能用户手动创建
- 新 thread 默认为空
- 进入旧 thread 时恢复完整历史
- 切换 agent 不会拆分 thread

### 12.3 Agent Rules

- 发送前必须选中 agent
- 如果当前只有一个可用 agent，可自动选中
- 如果有多个 agent，用户必须显式选择
- agent 缺少可用 runtime 时，不能发送

### 12.4 Runtime Rules

- runtime 由本地检测得到
- V1 不维护复杂 runtime marketplace
- 如果 runtime 不可执行，必须明确提示

### 12.5 Message Rules

- 同一 thread 中不同 agent 的消息按时间顺序展示
- 每条消息必须有 agent 标识
- 用户必须始终知道当前正在和谁对话

## 13. 状态设计

### 13.1 Project State

- `No Project`
- `Project Ready`
- `Project Invalid`

### 13.2 Thread State

- `Empty`
- `Active`
- `Running`
- `Failed`

### 13.3 Agent State

- `Available`
- `Missing Runtime`
- `Misconfigured`
- `Selected`

### 13.4 Runtime State

- `Detected`
- `Unavailable`
- `Unknown`

### 13.5 Run State

- `Queued`
- `Running`
- `Completed`
- `Errored`
- `Interrupted`

## 14. 空态与错误态

### 14.1 空态

`No Project`

- 用户还没有接入本地 project
- 明确引导先选择一个目录 / repo

`No Agent`

- 用户还没有创建任何 agent
- 主 chat 可见，但不能发送
- 明确引导去 `Agents` 创建第一个 agent

`No Runtime`

- 已有 agent，但没有可用 runtime
- 明确引导去 `Runtimes` 页面检测本地 CLI

`No Thread`

- 当前 project 下还没有任何 thread
- 明确引导用户创建新 thread

### 14.2 错误态

V1 至少要明确处理以下错误：

- project 路径不存在或不可访问
- runtime 不存在或不可执行
- agent 配置不完整
- 发送时未选中 agent
- runtime 执行失败

要求：

- 错误信息必须可理解
- 不吞错误
- 用户能知道下一步去哪修

## 15. 数据与持久化

V1 先做本地持久化，不做云同步。

建议持久化内容：

- project 列表
- 当前 / 最近使用 project
- thread 列表和消息历史
- agent 配置
- runtime 检测结果缓存
- 最近使用的 agent

V1 不要求跨设备同步，也不要求团队共享配置。

## 16. 功能范围分级

### 16.1 Must Have

- 本地 project 接入与切换
- 当前 project 下的 thread history
- 用户手动创建 thread
- chat 主工作区
- agent 选择与切换
- agent 全局管理
- runtime 检测与展示
- agent 绑定 runtime
- 在当前 project 路径中调用本地 runtime
- 结果回写 thread
- 基础状态和错误展示

### 16.2 Should Have

- 恢复上次 project
- 恢复上次 thread
- 记住最近使用 agent
- 基础运行中反馈
- 本地数据持久化

### 16.3 Nice to Have

- 更丰富的主题定制
- 更强的搜索
- 导入导出
- 多窗口

## 17. 成功标准

如果 V1 可以稳定满足以下结果，就算成立：

1. 用户能在多个本地 project 间切换
2. 用户能创建并维护自己的 agent 集合
3. 用户能给 agent 绑定不同本地 runtime
4. 用户能在某个 project 中创建 thread 并开始聊天
5. 用户能在同一个 thread 中切换 agent 而不丢上下文
6. 用户能在 GUI 中完成原本要在终端完成的一轮交流式工作
7. 当配置或执行失败时，用户知道问题在哪里

## 18. 后续演进路线

V1 之后，产品可以按以下顺序演进：

### Phase 2: 轻量任务化

- 从 chat 创建任务
- 任务来源追溯到 thread 或 message
- agent 可以创建任务草案
- 任务平铺，不做子任务树

### Phase 3: 任务状态与回溯

- 任务状态流转
- 任务依赖
- 从任务回看相关 thread、agent、结果

### Phase 4: 执行隔离

- 每个任务实例独立 worktree / branch
- 引入 run 和 agent 定义分离
- 支持同职责实例并行执行

### Phase 5: 多 agent 协同

- 多任务分发
- 依赖和阻塞可视化
- 轻量 inbox 和总结
- 用户集中查看协同进度

### Phase 6: 半自动调度

- agent 生成任务草案
- 基于依赖关系推荐分发
- 默认冲突阻止，允许用户 override

## 19. 一句话定义

Carrent V1 是一个面向本地代码项目的 agent chat workspace：用户在 GUI 中选择自己定义的 agent，让它在当前 project 上下文中调用本地 CLI 持续工作。
