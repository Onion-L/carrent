# 26 — 删除旧扁平模型并完成整体验证

**What to build:** 在所有三层用户流程完成后，删除为 expand 阶段保留的旧 Project/projectless Chat 状态、旧路由和兼容桥，使 Carrent 只通过 Workspace -> Project -> Thread 模型运行，并完成整体验收与文档一致性检查。

**Blocked by:** 17 — 添加跨 Workspace 待处理视图；18 — 添加分层 Thread 搜索；20 — 添加 Association 与 Workspace 级联移除；21 — 隔离 Runtime Session 连续性故障；22 — 处理 Project 目录不可用与重新定位；23 — 处理附件缺失与孤立数据；24 — 固定 Main Window 与重启生命周期；25 — 处理 schema 重置与 App State 损坏

**Status:** done

- [ ] 删除旧 flat Project、projectless Chat、`activeThreadId` 和旧 workspace snapshot 的生产读写路径，仅保留已决定的旧开发 schema 识别与重置逻辑。
- [ ] 删除旧 `/project/:projectId`、`/thread/:projectId/:threadId` 和 `/chat/:threadId` 的正常页面实现，只保留统一不兼容回退。
- [ ] 删除 expand 阶段的双模型适配、旧类型和不再使用的 mock/fixture，所有生产调用方使用三层领域语言与稳定身份。
- [ ] 所有 Runtime dispatch、附件、Runtime Session、Run Checklist、Settings 和 shutdown 行为继续通过三层 Thread/Project 上下文工作。
- [ ] 完成首次使用、共享 Project、Draft 首次发送、导航恢复、待处理、搜索、归档、级联删除、目录恢复、附件降级、单窗口重启和损坏恢复的主要 mounted-app 验收流程。
- [ ] 组件和人工验收确认三栏尺寸、折叠、Settings、长名称、确认弹窗、空状态和错误状态与已确认原型及规格一致。
- [ ] 更新受影响的领域/架构文档，删除把 App State Snapshot 或 Project Working Directory 称为产品 Workspace 的残留用法。
- [ ] `bun run lint`、`bun run typecheck`、`bun run build` 和相关 Desktop Bun tests 全部通过。
