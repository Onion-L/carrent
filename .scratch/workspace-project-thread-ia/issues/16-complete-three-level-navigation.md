# 16 — 完成三层导航与位置恢复

**What to build:** 将 Workspace、Project 和 Thread 连接成完整的三栏导航体验，包括概览、分组 Thread 列表、稳定深链接、浏览历史、每个 Workspace 的上次位置、启动恢复和缺失目标回退，同时保留现有 DesktopShell 的尺寸与手动折叠行为。

**Blocked by:** 15 — 从 Association Draft 创建 Thread

**Status:** done

- [ ] Workspace、Project 和 Thread 分别使用 `/workspace/:workspaceId`、`/workspace/:workspaceId/project/:projectId` 和 `/workspace/:workspaceId/project/:projectId/thread/:threadId`。
- [ ] 路由解析验证完整 Workspace-Project-Thread 归属链，名称和 Project Working Directory 路径不进入 URL。
- [ ] 左栏显示 Workspace，中栏只显示当前 Workspace 并按 Project 分组 Thread，右栏显示当前 Workspace、Project 或 Thread 内容。
- [ ] Thread 内容显示紧凑的 Workspace / Project / Thread 路径，中栏折叠时仍能识别当前位置。
- [ ] 切换 Workspace 恢复其最后有效 Thread；没有有效记录时进入 Workspace 概览，重复点击当前 Workspace 不导航。
- [ ] 用户主动打开 Workspace、Project 或 Thread 时增加浏览历史；启动恢复、失效目标回退和恢复操作使用 replace。
- [ ] Thread 缺失回退到 Project 概览，Project 缺失回退到 Workspace 概览，Workspace 缺失回退到 `/`，并显示一次可关闭的非阻塞提示。
- [ ] 有效身份内容加载失败时只替换右侧内容，提供“重试”和“打开上级概览”，且不将普通加载失败描述为数据损坏。
- [ ] 启动恢复最后活跃 Workspace/Thread；目标失效时按既定顺序回退到 Workspace 概览、首个 Workspace 或全局首次使用状态。
- [ ] 旧 `/project/:projectId`、`/thread/:projectId/:threadId` 和 `/chat/:threadId` 不转换身份，统一 replace 到 `/` 并显示一次不兼容提示。
- [ ] 保留 58px 左栏、默认 280px 且范围 200px-480px 的中栏、手动折叠、1080x720 最小窗口和无自动响应式降级规则。
- [ ] Mounted App + MemoryRouter 测试覆盖路由、归属校验、历史 push/replace、深链接和重启恢复；组件测试覆盖分组导航、路径和折叠控制。
