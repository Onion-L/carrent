# 19 — 添加 Thread 归档、恢复与永久删除

**What to build:** 为 Thread 提供可逆归档和 Settings 中的统一归档管理，并从归档区域提供原子永久删除。用户可以安全暂停和恢复历史，而不可逆删除始终与日常 Thread 操作分离。

**Blocked by:** 16 — 完成三层导航与位置恢复

**Status:** done

- [ ] 只有空闲且无排队消息的 Thread 可归档；同一 Thread 有 live Run 时归档入口被阻止。
- [ ] 归档保留 Thread 身份、标题、历史、附件、未发送 composer state、运行配置、Runtime Session、Rewind 数据、置顶和 Thread Activity Time。
- [ ] Archived Thread 从正常导航、搜索和待处理视图移除，且不能启动新 Run。
- [ ] Settings 提供跨 Workspace 的统一 Archived Thread 区域，并保留正常 Main Window 和 Settings Tabs 布局。
- [ ] 取消归档无需确认，恢复到原 Workspace 和 Project，不改变 Thread Activity Time，并在 Settings 提供显式打开入口。
- [ ] 单个活跃 Thread 只提供归档；永久删除只从 Archived Thread 区域发起并使用普通确认。
- [ ] 永久删除原子清理全部 Carrent-owned Thread 数据、附件快照、未发送状态、队列、Run Checklist、Runtime Session 映射和 Rewind 数据。
- [ ] 永久删除不撤销 Run Changes，也不修改 Project Working Directory、Git branch、commit、index、stash、refs 或 HEAD。
- [ ] 归档当前 Thread 后选择同一 Project 的下一活跃 Thread，无则进入 Project 概览；恢复留在 Settings，永久删除留在归档区并选择下一项。
- [ ] Renderer 测试覆盖可用性、归档/恢复导航和确认；持久化及清理测试验证原子成功、失败保留和不影响其他 Thread。
