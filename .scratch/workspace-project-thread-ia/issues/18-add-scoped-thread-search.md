# 18 — 添加分层 Thread 搜索

**What to build:** 提供一个可从全局、Workspace 或 Project 上下文进入的 Thread 标题搜索界面，让用户按明确范围查找活跃 Thread、浏览最近活动并回到完整三层上下文。

**Blocked by:** 16 — 完成三层导航与位置恢复

**Status:** ready-for-agent

- [ ] Cmd/Ctrl+K 默认打开全局搜索；Workspace 和 Project 入口分别默认选择当前 Workspace 和当前 Association 范围。
- [ ] 搜索界面始终显示当前范围，并允许在全局、Workspace 和 Association 三种范围间切换。
- [ ] 查询去除首尾空白、忽略大小写并使用标题子串匹配，不使用模糊搜索。
- [ ] 结果先按完全匹配、标题前缀匹配、其他子串匹配分级，同级按 Thread Activity Time 从新到旧排序。
- [ ] 结果显示完整 Workspace / Project / Thread 路径；置顶和 Thread Status 不影响搜索排序。
- [ ] 只搜索活跃 Thread 标题，排除消息正文、附件、Agent Activity、命令输出、Thread Draft 和 Archived Thread。
- [ ] 空查询最多显示当前范围内 20 个最近活动 Thread；有查询时显示全部匹配并由列表滚动承载。
- [ ] 无最近活动、无匹配和清除查询状态都明确保留范围，并允许切换范围；搜索空状态不创建 Thread。
- [ ] 打开其他 Thread 时关闭搜索、选择所属 Workspace 并新增导航历史；选择当前 Thread 只关闭搜索，Back 不重新打开搜索。
- [ ] 纯函数测试覆盖匹配、排序和范围过滤；Mounted Renderer 测试覆盖入口、空状态、范围切换和结果导航。
