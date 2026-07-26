# 决定 Workspace 多窗口打开语义

Type: grilling
Status: closed
Assignee: codex
Blocked by: 04, 05

## Question

Carrent Desktop App 是否允许多个窗口同时打开；若允许，一个 Workspace 能否出现在多个窗口、窗口与 Workspace/Project/Thread 选中状态如何归属，Thread Draft、活跃 Run、设置页、深链接、关闭与重启恢复如何在窗口之间协调，避免同一对象出现冲突控制或不明确的导航目标？

## Answer

- 目标版本只允许一个 Carrent Main Window，并将再次启动的应用实例交给现有实例处理；不支持同时用多个独立窗口浏览或控制 Workspace、Project 与 Thread，也不创建独立设置窗口。
- Workspace、Project、Thread、Thread Draft 与 Run 都不归窗口所有。唯一 Main Window 持有当前路由、选中状态和浏览历史，因此同一对象不会出现跨窗口草稿编辑、重复 Run 控制或互相覆盖导航状态的问题。
- 普通的再次启动只聚焦现有 Main Window，不改变当前位置。有效深链接聚焦现有窗口并导航到目标，导航期间保留 Thread Draft；无效深链接沿用既定的最近有效上级回退和非阻塞提示规则。
- 设置页是唯一 Main Window 内的应用级普通路由。进入前保留 Workspace、Project 或 Thread 位置，退出设置时返回；设置修改立即作用于整个应用。
- 关闭唯一 Main Window 等同于退出 Carrent，所有平台一致。没有活跃 Run 时保存状态后退出；存在活跃 Run 时先明确提示退出会取消这些 Run，用户确认后取消并退出，也可返回应用。窗口关闭后不允许 Run 在后台继续。
- 重启恢复沿用当前项目语义：恢复持久化的 Thread Draft 与既定的最后导航位置，但不自动恢复或继续上次 Run。遗留的 `running` Run 与运行中 activity 标记为 `cancelled`，已产生的消息和 Agent Activity 保留；未决 Approval Request、提问和运行中 Subagent Task 标记为 `interrupted`。用户必须显式发送新消息才能开始下一次 Run。

## Comments

- 2026-07-26: 目标版本只允许一个 Carrent 主窗口；不支持同时用多个独立窗口浏览或控制 Workspace、Project 与 Thread。
- 2026-07-26: 普通的再次启动只聚焦现有主窗口，不改变当前位置；有效深链接聚焦现有窗口并导航到目标，当前 Thread Draft 自动保留；无效深链接沿用既定的最近有效上级回退规则。
- 2026-07-26: 设置页作为应用级普通路由始终在唯一主窗口内打开，不创建独立设置窗口；进入前的位置保留，退出时返回，设置修改立即作用于整个应用。
- 2026-07-26: 关闭唯一主窗口等同于退出 Carrent，所有平台一致。没有活跃 Run 时保存状态后退出；存在活跃 Run 时先提示退出会取消这些 Run，确认后取消并退出。窗口关闭后不允许 Run 在后台继续。
- 2026-07-26: 重启恢复沿用当前项目语义：恢复导航位置与 Thread Draft，不自动续跑；遗留运行状态转为 cancelled，部分历史保留，未决交互与运行中 Subagent Task 转为 interrupted。
