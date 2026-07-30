# 18 — Thread 搜索(不分范围)

**What to build:** 提供一个可从任意上下文进入的 Thread 标题搜索界面,不按范围过滤,任何匹配的活跃 Thread 都展示,让用户查找活跃 Thread、浏览最近活动并回到完整三层上下文。

**Blocked by:** 16 — 完成三层导航与位置恢复

**Status:** done

- [ ] Cmd/Ctrl+K 和顶部搜索按钮打开同一个全局搜索;搜索不分 Global / Workspace / Association 范围,任何匹配的活跃 Thread 都展示。
- [ ] 查询去除首尾空白、忽略大小写并使用标题子串匹配,不使用模糊搜索。
- [ ] 结果先按完全匹配、标题前缀匹配、其他子串匹配分级,同级按 Thread Activity Time 从新到旧排序。
- [ ] 结果显示完整 Workspace / Project / Thread 路径;置顶和 Thread Status 不影响搜索排序。
- [ ] 只搜索活跃 Thread 标题,排除消息正文、附件、Agent Activity、命令输出、Thread Draft 和 Archived Thread。
- [ ] 空查询最多显示 20 个最近活动 Thread;有查询时显示全部匹配并由列表滚动承载。
- [ ] 无最近活动、无匹配和清除查询状态都有明确空状态;搜索空状态不创建 Thread。
- [ ] 打开其他 Thread 时关闭搜索、选择所属 Workspace 并新增导航历史;选择当前 Thread 只关闭搜索,Back 不重新打开搜索。
- [ ] 纯函数测试覆盖匹配和排序;Mounted Renderer 测试覆盖入口、空状态和结果导航。

## Comments

- 2026-07-30: 按用户要求移除搜索范围(Global / Workspace / Association 切换),搜索始终跨全部 Workspace / Project 展示所有匹配;同步删除了 `ThreadSearchScope` 类型、范围切换 UI 和相关测试。
