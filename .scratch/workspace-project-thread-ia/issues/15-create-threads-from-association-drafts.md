# 15 — 从 Association Draft 创建 Thread

**What to build:** 让用户从 Project 概览开始一段未发送的 Thread Draft，并在首次发送时原子创建固定归属当前 Workspace 和 Project 的 Thread。新 Thread 使用 Association 默认运行配置启动现有 Coding Agent 流程，同时 Carrent 继续拥有历史和 Thread 身份。

**Blocked by:** 14 — 在 Workspace 中添加和复用 Project

**Status:** ready-for-agent

- [ ] 每个 Workspace-Project Association 最多保存一个 Thread Draft，包含未发送内容、附件和所选运行配置。
- [ ] Thread Draft 可跨导航和应用重启恢复，但不创建 Thread、消息或 Runtime Session，也不进入任何现有 Thread 集合。
- [ ] 空 Project 概览提供“新建 Thread”，打开当前 Association 的 Draft；丢弃 Draft 会清理其未发送状态和附件引用。
- [ ] 首次发送原子创建全局唯一 Thread、第一条用户消息和必要运行状态，并删除对应 Thread Draft；任一失败保留可重试的原 Draft。
- [ ] Thread 固定保存 Workspace ID 和 Project ID，并验证对应 Association 存在；没有移动、脱离 Project 或 projectless Thread 路径。
- [ ] Thread 创建时复制 Association 当前 Runtime、模型和运行模式，之后独立持久化；后续修改 Association 不改变已有 Thread。
- [ ] Composer 显示 Thread 当前实际配置，每个 Run 记录实际使用配置，并使用所属 Project Working Directory 发起 Runtime dispatch。
- [ ] Thread ID 与 Runtime Session ID 分离，切换 Runtime 不创建新 Thread或替换 Carrent 历史。
- [ ] Renderer 测试覆盖 Draft 恢复、首次发送成功/失败和配置复制；Runtime/IPC 测试验证三层身份与 Project Working Directory 被正确传入现有执行边界。
