# 21 — 隔离 Runtime Session 连续性故障

**What to build:** 将 Runtime Session 明确绑定到 Runtime 和 Carrent Thread，并在映射缺失、结构无效或 Runtime 拒绝恢复时只影响对应连续性句柄。Thread 历史和其他 Runtime/Thread 始终保持可用，失败请求不会被静默重复执行。

**Blocked by:** 15 — 从 Association Draft 创建 Thread

**Status:** ready-for-agent

- [ ] Runtime Session 映射键固定为 Runtime ID + 全局唯一 Thread ID，不包含 Workspace、Project 或目录路径。
- [ ] 同一 Thread 可以为不同 Runtime 保存独立映射，切换 Runtime 不改变 Thread 身份或历史。
- [ ] 映射缺失视为没有旧 Session，下次 Run 创建新 Runtime Session，不显示持久化损坏状态。
- [ ] Run 前发现单条映射格式无效或引用不一致时，只解除该映射并显示一次非阻塞提示。
- [ ] 无效映射不阻止 Thread 历史、其他 Thread、其他 Runtime 映射或后续新 Session Run。
- [ ] Runtime 报告 Session 不存在或拒绝恢复时，本次 Run 以可见失败结束，不自动使用新 Session 重放请求。
- [ ] 失败状态提供“移除 Runtime Session 并重试”，只删除对应映射，并由用户动作重新提交本次请求。
- [ ] Thread 永久删除和既定 Rewind 操作继续解除该 Thread 的相关 Runtime Session。
- [ ] Provider-session store 和 session-manager 测试覆盖键、不同行为分支、隔离范围及无静默重复 dispatch。
