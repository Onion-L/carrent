# 决定主要屏幕、窗格组合与窄窗口行为

Type: prototype
Status: closed
Assignee: codex
Blocked by: 04, 10

## Question

在已选定的三栏导航模型（左栏 Workspace、中栏按 Project 分组的 Thread 导航、右栏内容）基础上，用可交互原型决定 Carrent Desktop App 的主要屏幕清单及其窗格组合，包括 Workspace、Project、Thread 与 Settings 等页面分别显示哪些窗格，窗格的默认宽度、调整尺寸、折叠入口与恢复规则，以及窗口变窄时三栏如何降级和切换。不得重新讨论已确定的层级导航语义，也不负责各层空状态、失败提示和恢复文案。

## Answer

- 目标版本复用当前 `DesktopShell` 的整体布局与视觉结构，不重新设计窗口框架：保留顶部栏、固定窄左栏、可调中栏和右侧内容区，只替换各窗格承载的三层信息架构语义。
- 主要屏幕为 Workspace 概览、Project 概览、Thread 和 Settings。Workspace、Project 与 Thread 页面统一保留三栏：左栏显示 Workspace，宽度固定 `58px`；中栏显示当前 Workspace 下按 Project 分组的 Thread 导航；右栏显示当前 Workspace、Project 或 Thread 的内容。
- Settings 继续作为唯一 Main Window 内的普通页面复用同一布局。左栏保持可见并由底部 Settings 入口表示选中；中栏切换为 Settings Tab 列表；右栏显示当前设置内容。进入和退出 Settings 的导航规则沿用既定的返回前一位置语义。
- 中栏保留当前尺寸与调整规则：默认宽度 `280px`，可拖动范围为 `200px` 至 `480px`；使用顶部现有折叠按钮折叠和展开。同一次应用运行中，重新展开恢复折叠前的宽度；应用重启后回到默认 `280px`，不持久化手动宽度或折叠状态。
- Main Window 保留当前最小尺寸 `1080×720`。窗口缩小到最小宽度时三栏不自动降级，不引入抽屉、覆盖导航、单窗格逐级切换或底部导航；左栏持续显示，中栏持续占用当前宽度，用户需要更多内容空间时手动折叠中栏。
- 拒绝按页面移除导航窗格的方案，因为它改变现有页面框架并使层级位置的可见性不一致；拒绝在中窄窗口自动改为抽屉或单窗格的方案，因为当前最小窗口尺寸已经提供可用边界，新增响应式状态会扩大实现和恢复规则。
- 原型主来源保存在本地分支 `codex/prototype-screen-pane-behavior` 的提交 `3732c42`，入口文件为 `apps/desktop/src/renderer/routes/ScreenPanePrototypePage.tsx`。

## Comments

- 2026-07-26: 三套屏幕与窗格行为原型已归档到本地分支 `codex/prototype-screen-pane-behavior`，提交 `3732c42`，入口为 `apps/desktop/src/renderer/routes/ScreenPanePrototypePage.tsx`。等待 HITL 评审后记录决议。
- 2026-07-26: HITL 评审要求复用当前 Desktop App 布局，不做大幅结构调整：保留现有顶部栏、窄左侧栏、可调中栏与右侧内容区的整体框架，只将左栏语义改为 Workspace 切换、中栏内容改为当前 Workspace 下按 Project 分组的 Thread 导航，并补充不同页面和窄窗口的行为。
- 2026-07-26: 确定 Workspace、Project 与 Thread 页面统一使用现有三栏布局：左栏显示 Workspace，中栏显示当前 Workspace 下按 Project 分组的 Thread 导航，右栏显示当前层级内容；Settings 也复用同一布局，左栏保留并由底部 Settings 入口表示选中，中栏切换为设置分类，右栏显示设置内容。
- 2026-07-26: 确定保留现有窗格尺寸与手动控制规则：左栏固定 `58px`；中栏默认 `280px`，可拖动范围 `200px` 至 `480px`；顶部现有按钮负责折叠和展开；同一次运行中展开恢复折叠前宽度，应用重启后回到默认 `280px`。
- 2026-07-26: 确定保留最小窗口 `1080×720` 与现有缩窄行为；三栏不自动降级，用户通过现有按钮手动折叠中栏。
