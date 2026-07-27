# 20 — 添加 Association 与 Workspace 级联移除

**What to build:** 让用户安全移除 Workspace-Project Association 或删除 Workspace，并只级联删除对应作用域内的 Carrent Thread 和 Draft。共享 Project、其他 Workspace 和本地目录保持不变，所有永久操作具有明确范围和确定性落点。

**Blocked by:** 19 — 添加 Thread 归档、恢复与永久删除

**Status:** done

- [ ] 移除 Association 会原子删除该 Workspace-Project 组合的 Thread Draft 和全部 Thread，包括其 Carrent-owned 附属数据。
- [ ] 删除 Workspace 会原子删除其全部 Association、Thread Draft 和 Thread，不影响其他 Workspace 的 Association 或 Thread。
- [ ] 任一受影响 Thread 有 live Run 时，在显示确认前阻止操作；其他 Project 的 Run 不构成阻塞。
- [ ] 确认显示受影响 Thread 数量，并明确 Project Working Directory、项目文件、Git 状态和其他 Workspace 不受影响。
- [ ] Association 或 Workspace 的 Draft 可随父对象直接丢弃，不单独阻止删除。
- [ ] 共享 Project 在其他 Workspace 中继续存在；Project 的最后一个 Association 删除后自动移除 Carrent Project 记录。
- [ ] 不提供全局 Project 删除，也不复制、移动或删除 Project Working Directory。
- [ ] Association 删除后进入 Workspace 概览；Workspace 删除后选择排序中的下一项、无则前一项、全部删除后进入全局首次使用状态。
- [ ] 删除失败时完整保留原有对象、导航可解析状态和附件引用，不暴露部分级联结果。
- [ ] Mounted Renderer 测试覆盖阻塞、确认和落点；持久化测试覆盖共享 Project、最终 Project 清理和级联原子性。
