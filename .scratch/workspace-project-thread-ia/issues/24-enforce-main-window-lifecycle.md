# 24 — 固定 Main Window 与重启生命周期

**What to build:** 让 Carrent 只使用一个 Main Window 负责三层路由、Settings 和 Run 控制。重复启动与深链接聚焦现有窗口，关闭窗口明确结束应用，重启后把遗留的运行中交互恢复为诚实的 cancelled/interrupted 状态。

**Blocked by:** 16 — 完成三层导航与位置恢复

**Status:** ready-for-agent

- [ ] 应用同时只存在一个 Main Window；重复普通启动只聚焦现有窗口，不改变当前路由或选择。
- [ ] 有效深链接聚焦现有窗口并导航到目标，同时保留当前未发送状态；无效深链接使用既定回退和提示。
- [ ] Settings 是 Main Window 内的普通路由，左栏保持可见，中栏显示 Settings Tabs，退出时返回进入前位置。
- [ ] Workspace、Project、Thread、Thread Draft 和 Run 不归窗口所有，唯一 Main Window 持有当前路由、选择和浏览历史。
- [ ] 关闭 Main Window 等同于退出 Carrent，所有平台行为一致，窗口关闭后不允许 Run 在后台继续。
- [ ] 没有 live Run 时保存状态后退出；存在 live Run 时提示退出会取消这些 Run，用户可确认退出或返回应用。
- [ ] 重启不自动恢复或继续 Run；遗留 running Run 和运行中 Agent Activity 标记为 cancelled，并保留已产生历史。
- [ ] 未决 Approval Request、用户问题和运行中 Subagent Task 标记为 interrupted，用户必须显式发送新消息开始下一 Run。
- [ ] Main-process 和 Mounted Renderer 测试覆盖单实例聚焦、深链接、Settings 返回、关闭确认、状态保存和重启归一化。
