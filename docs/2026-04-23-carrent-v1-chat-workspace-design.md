# Carrent V1 PRD

- Date: 2026-05-09
- Status: Draft
- Scope: V1
- Product: Carrent

## 1. 产品定位

Carrent V1 是一个可切换 runtime / proxy / model 的本地 coding agent GUI。

它的目标不是做一个新的 IDE，不是替代 Claude Code / Codex / opencode，也不是做多 agent 协作平台。V1 只解决一个明确问题：

`用户已经有本地 coding agent CLI，也有自己的 proxy / provider 配置，但缺少一个像 Codex GUI 一样顺手、同时允许自由切换节点和模型的桌面工作台。`

一句话：

`Carrent V1 = cc switch 的 provider/profile 控制能力 + Codex GUI 的本地聊天体验。`

## 2. 目标用户

V1 的核心用户是独立开发者和高频 AI coding 用户。

典型特征：

- 已经使用 Claude Code、Codex CLI、opencode 或类似本地 coding agent CLI
- 会在官方节点、proxy 节点、本地网关之间切换
- 需要按项目保存 chat 历史
- 喜欢 GUI，但不想被某个 GUI 的 provider/model 限制
- 不需要 Carrent 重新定义完整开发流程

## 3. 核心问题

当前工作流的问题不是“没有 AI coding agent”，而是：

- CLI 灵活，但长期 chat、历史、项目切换体验弱
- Codex GUI 好用，但 provider / proxy / model 控制不够自由
- cc switch 类工具能切节点，但不是 GUI 工作台
- 不同项目、thread、runtime profile 的状态分散

V1 要解决的是：

`让用户在一个桌面 GUI 中，为当前本地项目选择 runtime、provider profile、model 和运行权限，然后持续聊天。`

## 4. V1 产品模型

V1 的核心对象只保留四个：

- `Project`
  - 一个本地 repo / folder
  - 决定 CLI 执行时的 cwd
- `Thread`
  - 某个 project 下的一段聊天历史
  - 保存上次使用的 runtime / profile / model / run mode
- `Runtime`
  - 本地 CLI 执行入口
  - V1 支持 `codex` 和 `claude-code`
  - `opencode` 预留结构，确认启动参数后再接入
- `Provider Profile`
  - runtime 的节点和模型配置
  - 用于官方节点、proxy、自定义网关、本地网关

`Agent` 不再是 V1 核心对象。V1 可以保留一个默认 prompt，或把已有 Agents 页面隐藏到后续版本。

## 5. V1 目标

V1 必须做到：

1. 用户可以选择一个本地 project
2. 用户可以创建和管理 provider profiles
3. 用户可以选择 runtime、profile、model 和 run mode
4. 用户可以在 GUI 中向本地 CLI 发送消息
5. CLI 在当前 project 路径中执行
6. 输出以 streaming 方式回写到当前 thread
7. shell / reasoning 输出可以继续展示
8. thread history 本地保存，下次打开可以继续
9. 配置错误时，用户能看懂问题在哪里

## 6. V1 非目标

V1 明确不做：

- 完整 Agent CRUD
- 多 agent 协作
- agent-to-agent
- task 系统
- plan reader
- 自动调度
- marketplace
- 云同步
- 登录 / 账号
- 团队协作
- landing page
- 复杂 runtime verifier / model ping 主流程
- 自动修改所有外部 CLI 配置
- IDE 插件

V1 不追求覆盖所有 AI coding 使用方式，只先做一个自己愿意每天打开的本地 GUI。

## 7. 核心原则

### 7.1 Product Principle

- 先解决 runtime / proxy / model 切换
- GUI chat 是主体验
- 不提前做多 agent 平台
- 不保存明文 API key
- 能复用本地 CLI 就不重新实现 provider 协议

### 7.2 Interaction Principle

- 打开后应能直接开始 chat
- 不强制先创建 agent
- profile/model 切换应该在 composer 附近
- project 是执行上下文，不是复杂管理后台
- 错误提示要告诉用户下一步怎么修

### 7.3 Scope Principle

- V1 只围绕 `Project + Thread + Runtime + Provider Profile`
- Agent、Plan、Task 都后置
- 先把一个常用路径做顺，不做大而全设置系统

## 8. 对象模型

### 8.1 Project

定义：

- 一个本地 repo / folder
- Carrent 调用 runtime 时使用它作为 cwd

最小字段：

- `id`
- `name`
- `path`
- `threads`

规则：

- project path 不存在时不能执行
- thread history 按 project 隔离
- 记住最近使用 project

### 8.2 Thread

定义：

- project 下的一段聊天历史

最小字段：

- `id`
- `title`
- `updatedAt`
- `runtimeId`
- `profileId`
- `model`
- `runtimeMode`
- `pinned`
- `archived`

规则：

- thread 保存上次使用的 runtime / profile / model / run mode
- 切换 profile 只影响下一次发送
- 新 thread 可以继承 project 默认 profile

### 8.3 Runtime

定义：

- 本地可执行 CLI

V1 支持：

- `codex`
- `claude-code`

预留：

- `opencode`

最小展示信息：

- runtime 名称
- command
- command path
- version
- availability

规则：

- V1 只需要判断命令是否可用
- model ping 不作为主流程阻塞项
- CLI 启动参数必须通过实际验证后再接入

### 8.4 Provider Profile

定义：

- runtime 的 provider / proxy / model 配置

最小字段：

- `id`
- `name`
- `runtimeId`
- `baseUrl`
- `model`
- `apiKeyEnvName`
- `envOverrides`
- `isDefault`

规则：

- 不保存明文 API key
- `apiKeyEnvName` 指向系统环境变量
- `envOverrides` 只保存非敏感配置
- profile 可以绑定某个 runtime
- thread 可以记住上次使用 profile

### 8.5 Message

定义：

- thread 中的一条用户或 assistant 消息

规则：

- 消息属于 thread
- assistant 消息可以包含 text / reasoning / shell parts
- 错误以 assistant message 形式展示，但要有明确错误文案

### 8.6 Run

定义：

- 一次真实的 CLI 执行

规则：

- cwd 使用当前 project path
- runtime 使用当前 thread/composer 选择
- profile 注入到 CLI 环境或参数
- run mode 决定 CLI 权限模式
- run 输出回写到当前 thread

## 9. 信息架构

V1 保留三个主要区域：

1. `Chat`
2. `Runtimes`
3. `Settings`

说明：

- `Chat` 是主入口
- `Runtimes` 只显示本地 CLI 状态
- `Settings` 管理 provider profiles 和默认项
- `Agents` 不作为 V1 主入口，可以隐藏或降级

## 10. 页面结构

### 10.1 Chat

主工作区。

结构：

- 左侧：project / thread history
- 中间：message timeline
- 底部：composer
- composer 附近：runtime / profile / model / run mode switcher

关键规则：

- 没有 project 时先选择 project
- 没有 profile 时可以使用 runtime 默认环境
- 发送前可以切换 runtime / profile / model / run mode
- 发送后 thread 记住当前选择
- 运行中可以 stop

### 10.2 Runtimes

用于查看本地 CLI 是否可用。

功能：

- 展示 `codex`
- 展示 `claude-code`
- 展示 command path / version
- 展示 available / unavailable
- 提供 refresh

不做：

- runtime marketplace
- 复杂进程管理
- 强制 model ping

### 10.3 Settings

用于管理 profiles 和默认项。

功能：

- provider profile 列表
- 新增 / 编辑 / 删除 profile
- 设置默认 runtime / profile
- 设置默认 project 恢复策略

profile 表单字段：

- name
- runtime
- baseUrl
- model
- apiKeyEnvName
- envOverrides

## 11. 核心流程

### 11.1 First-Time Flow

1. 用户打开 Carrent
2. 选择本地 project
3. 选择 runtime
4. 创建或选择 provider profile
5. 输入消息
6. Carrent 在 project cwd 中启动 CLI
7. 输出回写到 thread

### 11.2 Normal Flow

1. 用户打开 Carrent
2. 自动恢复上次 project / thread
3. composer 显示上次 runtime / profile / model / run mode
4. 用户发送消息
5. runtime 使用 profile 配置执行
6. streaming 输出进入 message timeline

### 11.3 Profile Switching Flow

1. 用户在 composer 中切换 profile
2. 可选修改 model
3. 发送下一条消息
4. 当前 run 使用新 profile
5. thread 记住新选择

## 12. 错误状态

V1 至少处理：

- project path 不存在
- runtime command 不存在
- runtime 执行失败
- profile 缺少 runtime
- profile 缺少 model
- profile 指向的 apiKeyEnvName 不存在
- baseUrl 配置无效
- CLI 不支持当前注入方式

错误文案要求：

- 说明哪里错了
- 说明用户下一步该检查什么
- 不吞 stderr

## 13. 数据与持久化

V1 使用本地 JSON 持久化。

保存：

- project 列表
- 当前 / 最近 project
- thread 列表
- message 历史
- runtime / profile / model / run mode 选择
- provider profiles

不保存：

- 明文 API key
- 云端账号信息
- provider 返回的敏感内容之外的额外凭据

## 14. 功能范围

### 14.1 Must Have

- 本地 project 选择与恢复
- project 下 thread history
- GUI chat
- streaming 输出
- stop run
- shell / reasoning 展示
- runtime 选择
- profile 选择
- model 选择
- run mode 选择
- provider profile 管理
- runtime command 可用性展示
- 本地 JSON 持久化
- 基础错误状态

### 14.2 Should Have

- project 默认 profile
- thread 记住最后一次 profile
- profile 复制
- env key 是否存在的提示
- opencode runtime 接入

### 14.3 Nice to Have

- Agent prompt presets
- Plan Reader
- 导入 / 导出 profiles
- profile 分组
- 搜索历史
- 多窗口

## 15. 成功标准

如果 V1 可以稳定完成以下流程，就算成立：

1. 用户选择一个 repo
2. 用户选择 `codex` 或 `claude-code`
3. 用户选择官方节点或自己的 proxy profile
4. 用户选择 model
5. 用户选择只读 / 允许编辑 / full access
6. 用户在 GUI 中发送消息
7. CLI 在当前 repo 中执行
8. 输出、命令、reasoning、错误都能显示
9. thread 历史保存
10. 下次打开可以继续

## 16. 后续演进

V1 之后再考虑：

### Phase 2: Agent Presets

- 自定义 prompt preset
- 每个 preset 默认 runtime/profile
- 不做 agent 协作

### Phase 3: Plan Reader

- 从 chat 中保存 plan
- 独立阅读和回看
- 不自动调度

### Phase 4: Task

- 从 thread 创建轻量 task
- task 关联 thread/message
- 不做复杂任务树

### Phase 5: 多 Agent

- 多 agent 协作
- 分工和状态展示
- 任务分发

## 17. 一句话定义

Carrent V1 是一个可切换 runtime、proxy 和 model 的本地 coding agent GUI：用户选择本地 project，在桌面界面中用自己的 provider profile 调用 Codex、Claude Code 或其他本地 CLI 持续工作。
