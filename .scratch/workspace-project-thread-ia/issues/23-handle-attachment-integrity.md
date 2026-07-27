# 23 — 处理附件缺失与孤立数据

**What to build:** 在 App State 仍可信时隔离附件存储的局部故障。历史消息保持可读，未发送 Draft 不会把不可用文件交给 Runtime，生命周期清理和孤立文件回收不会误删仍被引用的数据。

**Blocked by:** 15 — 从 Association Draft 创建 Thread；20 — 添加 Association 与 Workspace 级联移除

**Status:** done

- [ ] 已发送消息引用的附件缺失、损坏或无法读取时，消息和 Thread 历史继续显示，附件标记为“文件不可用”。
- [ ] 不可用历史附件不能预览、读取或传给 Runtime，也不得回退读取原始来源路径，但不阻止 Thread 的后续 Run。
- [ ] Thread Draft 引用不可用附件时阻止发送，并允许用户移除或重新添加该附件。
- [ ] 附件完整性故障只影响对应附件，不阻止整个 Thread、其他 Thread 或 App，也不触发完整重置。
- [ ] Thread、Association 和 Workspace 删除只清理其独占附件；仍被其他消息、composer state、队列或 Draft 引用的 storage key 必须保留。
- [ ] App State 完整验证成功后，可以自动删除附件目录中没有任何有效引用的孤立文件。
- [ ] App State 无法验证时不执行孤立附件判定或局部清理。
- [ ] 附件 store/IPC 和 Renderer 测试覆盖缺失历史附件、Draft 阻塞、原路径禁止、共享引用保护、级联清理和孤立文件回收。
