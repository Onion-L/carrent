# 用低保真原型决定三层导航模型

Type: prototype
Status: closed
Assignee: codex
Blocked by: 01, 02, 03

## Question

用可交互的低保真原型比较并决定 Workspace、Project、Thread 的主导航模型：用户如何看见当前位置、切换每一层、进入和退出 Thread、返回上次位置、处理深链接与浏览历史，以及在无选中项、目标不存在或应用重启恢复时落到哪里。答案应记录选定模型、被拒绝的主要替代方案和关键交互规则，而不是视觉稿或生产代码。

## Answer

- 主导航采用三栏布局：左栏是 Workspace 切换栏；中栏只展示当前 Workspace，并按 Project 分组列出其 Thread；右栏承载 Workspace 概览、Project 概览或 Thread 内容。Workspace、Project、Thread 的选中态与内容头部的 `Workspace / Project / Thread` 紧凑路径共同表达当前位置。
- 左栏切换到其他 Workspace 时，恢复该 Workspace 最后访问的 Thread；没有历史或记录目标已删除时进入 Workspace 概览。重复点击左栏当前 Workspace 不执行导航；点击中栏顶部 Workspace 标题进入 Workspace 概览，点击 Project 标题进入 Project 概览。
- 应用重启恢复关闭前最后活跃的 Workspace 与 Thread；目标失效时进入该 Workspace 概览。没有任何可恢复位置时，若已有 Workspace，则打开稳定排序中的第一个 Workspace 概览；若没有 Workspace，则显示创建 Workspace 的全局空状态。
- 用户主动切换 Workspace、打开 Project 或进入 Thread 时新增浏览历史，使前进与后退逐步回放显式导航。重启恢复和无效目标回退只替换当前位置，不新增历史。
- Thread 深链接包含 Workspace、Project、Thread 三层稳定 ID，并校验三者归属关系；名称与 Project Working Directory 路径不进入 URL。无效深链接回退到最近仍有效的上级：Thread 缺失进入 Project 概览，Project 缺失进入 Workspace 概览，Workspace 缺失进入 Workspace 选择页，并显示一次非阻塞提示。
- Thread 是普通导航页面，不提供独立关闭或退出按钮；用户通过点击 Workspace、Project 或使用历史后退离开 Thread。
- 拒绝四栏方案，因为同时固定 Workspace、Project、Thread 与内容会过度压缩主要工作区；拒绝逐级钻取方案，因为进入 Thread 后会隐藏同级与上级导航；拒绝把所有 Workspace 混入一棵全局树，因为跨 Workspace 信息密度过高；拒绝 Project 选择器方案，因为它隐藏同一 Workspace 内的 Project 上下文并增加切换步骤。
- 原型主来源保存在本地分支 `codex/prototype-workspace-navigation` 的提交 `812517207fcb0528f7e948805ef82fb6737c46f4`，入口文件为 `apps/desktop/src/renderer/routes/NavigationPrototypePage.tsx`。

## Comments

- 2026-07-26: 交互原型已归档到本地分支 `codex/prototype-workspace-navigation`，提交 `812517207fcb0528f7e948805ef82fb6737c46f4`。
- 2026-07-26: 新增三栏对比方案 D（中栏展开所有 Project 与 Thread）和 E（中栏使用 Project 选择器并只展示当前 Project 的 Thread）。
- 2026-07-26: HITL 评审选择 D 作为主导航基线：左栏切换 Workspace，中栏按 Project 分组展示该 Workspace 的 Thread，右栏承载当前层级内容。
- 2026-07-26: 每个 Workspace 记住最后访问的 Thread；切回 Workspace 时恢复该 Thread。没有历史或记录目标已删除时显示 Workspace 概览。
- 2026-07-26: 应用重启后恢复关闭前最后活跃的 Workspace 与 Thread；目标失效时回到该 Workspace 概览。
- 2026-07-26: 用户主动切换 Workspace、打开 Project 或进入 Thread 时新增浏览历史；应用重启恢复和失效目标回退只替换当前位置，不新增历史。
- 2026-07-26: Thread 深链接包含 Workspace、Project、Thread 三层稳定 ID，并校验三者归属关系；名称和本地目录路径不进入 URL。
- 2026-07-26: 无效深链接回退到最近仍有效的上级：Thread 缺失进入 Project 概览，Project 缺失进入 Workspace 概览，Workspace 缺失进入 Workspace 选择页；同时显示一次非阻塞提示。
- 2026-07-26: Thread 是普通导航页面，不提供独立关闭或退出按钮；用户通过点击中栏中的 Project、Workspace，或使用历史后退离开 Thread。
- 2026-07-26: 没有可恢复位置时，若已有 Workspace，则打开稳定排序中的第一个 Workspace 概览；若没有 Workspace，则显示引导创建 Workspace 的全局空状态。
- 2026-07-26: Thread 内容头部显示 `Workspace / Project / Thread` 紧凑路径；即使导航栏折叠，当前位置仍保持明确。
- 2026-07-26: 左栏 Workspace 按钮只负责切换并恢复该 Workspace 的最后 Thread；重复点击当前 Workspace 不执行导航。中栏顶部 Workspace 标题进入当前 Workspace 概览。
