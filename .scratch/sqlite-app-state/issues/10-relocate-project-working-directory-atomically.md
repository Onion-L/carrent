# 10 — 原子迁移 Project Working Directory

**What to build:** 让用户重新定位 Project Working Directory 时，Carrent 原子更新 Project path 并解除该 Project 的 Runtime Sessions；任何验证、数据库或外部 Runtime 状态失败都保留旧路径和连续性状态。

**Blocked by:** 02 — 持久化 App State 身份与导航图; 04 — 迁移 Runtime Session 映射到 SQLite

**Status:** completed

- [x] Relocation 继续要求目标目录存在、未属于其他 Project，且该 Project 没有 live Run。
- [x] owning Project path 与所有受影响 Runtime Session mappings 在同一 SQLite transaction 更新。
- [x] Relocation 保留 Workspace-Project Associations、Threads、Messages、attachments、Thread Drafts 和运行配置。
- [x] Runtime-owned in-memory sessions 在数据库提交前安全 detach，并以 receipt 保留可恢复信息。
- [x] 路径或 Runtime Session 数据库写入失败时，事务回滚且外部 Runtime 状态恢复到 relocation 前。
- [x] 外部状态无法完整恢复时返回明确失败并保持 App State authority 不发布未确认 Snapshot。
- [x] commit 成功后旧 Runtime Sessions 不再可恢复，后续 Run 使用新的 Project Working Directory 创建上下文。
- [x] 并发 relocation 串行执行，执行期间冲突的 App State command 不会覆盖已验证的 before state。
- [x] Tests 覆盖成功、重复目录、live Run、数据库失败、receipt 恢复失败、并发请求及关闭重开。

## Implementation note

SQLite App State Store 现在提供 row-level Project relocation transaction，在同一 shared queue item 内校验 validated before state，并提交 Project path 与受影响 Runtime Session mappings。Project relocation manager 在事务前 detach Runtime-owned sessions 和 in-memory Provider Session cache，失败时使用 receipt 恢复，成功后才发布 committed App State Snapshot。

当前生产入口仍保留 JSON App State Store 的兼容路径；issue 12 切换生产 App State authority 到 SQLite 后会直接使用本 issue 的原子路径。
