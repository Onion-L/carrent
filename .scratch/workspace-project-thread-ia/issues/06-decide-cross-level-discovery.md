# 决定跨层发现与注意力管理

Type: grilling
Status: closed
Assignee: codex
Blocked by: 02, 04

## Question

用户如何在多个 Workspace 和 Project 之间发现并回到需要处理的 Thread：搜索、最近访问、置顶、运行中、等待批准、等待回答、失败等入口分别在哪一层聚合；默认范围、排序、状态优先级、结果中的层级路径和跳转后的上下文如何定义，避免三层结构让活跃 Thread 变得难找？

## Answer

- 提供应用级「待处理」入口，固定在左侧 Workspace 切换栏顶部并显示数量徽标。它跨全部 Workspace 聚合等待批准、等待回答和 Failed Thread；Running、最近活动、置顶、搜索结果、Archived Thread 与 Thread Draft 不进入该视图。
- 打开待处理时只将中栏临时替换为跨 Workspace 列表，右侧继续保留当前 Workspace、Project 或 Thread 内容；不使用弹窗、不新增第四栏、不自动打开第一项，也不新增待处理概览页。
- 待处理按等待批准、等待回答、Failed 分组并固定此优先级，组内按 Thread Activity Time 从新到旧。置顶不影响排序，每项显示 Workspace / Project 路径。
- 从待处理列表打开 Thread 时退出全局视图，选中其所属 Workspace，并在正常三栏导航中打开。该跳转进入浏览历史；后退恢复待处理列表原有分组、滚动位置和选中项。
- Running 不提供应用级聚合入口或全局列表，只作为 Thread 自身状态显示在正常导航的 Thread 项上。
- 正常 Workspace 导航中的状态不改变排序：每个 Project 分组仍将置顶 Thread 排在普通 Thread 前面，两组内分别按 Thread Activity Time 从新到旧。等待批准、等待回答、Running、Failed 只显示在 Thread 项上，Project 标题和 Workspace 图标不显示聚合状态。
- 复用一个 Thread 搜索界面。Cmd/Ctrl+K 默认搜索全部 Workspace，Workspace 标题入口默认搜索当前 Workspace，Project 标题入口默认搜索当前 Workspace-Project Association；界面明确显示范围并允许在三种范围间切换。
- 搜索只匹配活跃 Thread 标题。匹配前去除查询首尾空白并忽略大小写，使用子串匹配而非模糊搜索；结果依次按完全匹配、标题前缀匹配、其他子串匹配分级，同级按 Thread Activity Time 从新到旧。置顶和状态不影响搜索排序，每项显示完整 Workspace / Project / Thread 路径。
- Thread Draft、Archived Thread、消息正文、附件、Agent Activity 和命令输出不进入搜索。从搜索结果打开 Thread 时关闭搜索，选中所属 Workspace 并进入正常三栏导航；跳转进入浏览历史，但后退不重新打开搜索。选择当前 Thread 时只关闭搜索。
- 不新增 Last Viewed Time，也不提供独立「最近访问」入口。短期回访使用浏览历史，每个 Workspace 继续恢复最后访问的 Thread；搜索框为空时最多展示当前范围内 20 个最近活动 Thread，并按 Thread Activity Time 从新到旧。
- 置顶只在 Thread 所属 Workspace 的对应 Project 分组内生效；不提供 Workspace 级置顶区或全局置顶入口，也不把同一 Thread 重复展示到其他区域。

## Comments

- 2026-07-26: 提供应用级「待处理」入口，跨全部 Workspace 聚合等待批准、等待回答和 Failed Thread。Running 只表示进度，不进入待处理；最近访问、置顶和搜索也不混入该入口。
- 2026-07-26: 「待处理」作为左侧 Workspace 切换栏顶部的固定入口并显示数量徽标；打开后中栏临时替换为跨 Workspace 待处理列表，不使用弹窗，也不新增第四栏。
- 2026-07-26: 待处理按等待批准、等待回答、Failed 分组并固定此优先级；组内按 Thread Activity Time 从新到旧，置顶不影响排序，每项显示 Workspace / Project 路径。
- 2026-07-26: 从待处理列表打开 Thread 时退出全局视图，选中其所属 Workspace，并在正常三栏导航中打开；该跳转进入浏览历史，后退恢复待处理列表原有分组、滚动位置和选中项。
- 2026-07-26: Running 不提供应用级聚合入口或全局列表，延续当前模型，仅作为 Thread 自身状态展示在正常导航的 Thread 项上。
- 2026-07-26: 正常 Workspace 导航中的 Thread 状态不改变排序；仍按置顶组优先、组内 Thread Activity Time 从新到旧。等待批准、等待回答、Running、Failed 只显示在 Thread 项上，Project 标题和 Workspace 图标不显示聚合状态。
- 2026-07-26: 复用一个 Thread 搜索界面；Cmd/Ctrl+K 默认全局范围，Workspace 标题入口默认当前 Workspace，Project 标题入口默认当前 Workspace-Project Association。界面明确显示当前范围，并允许在三种范围间切换。
- 2026-07-26: Thread 搜索只匹配活跃 Thread 的标题，不搜索消息正文、附件、Agent Activity、命令输出、Thread Draft 或 Archived Thread。
- 2026-07-26: 标题搜索使用去除首尾空白、大小写不敏感的子串匹配，不做模糊搜索；结果依次按完全匹配、标题前缀匹配、其他子串匹配分级，同级按 Thread Activity Time 从新到旧。置顶和状态不影响排序，每项显示完整 Workspace / Project / Thread 路径。
- 2026-07-26: 从搜索结果打开 Thread 时关闭搜索，选中其所属 Workspace，并在正常三栏导航中打开；跳转进入浏览历史，但后退只返回搜索前页面，不重新打开搜索。选择当前 Thread 时只关闭搜索。
- 2026-07-26: 不新增 Last Viewed Time，也不提供独立「最近访问」入口。短期回访使用浏览历史，每个 Workspace 继续恢复最后访问的 Thread；全局搜索在空查询时按 Thread Activity Time 展示最近活动 Thread。
- 2026-07-26: 置顶只在 Thread 所属 Workspace 的对应 Project 分组内生效，该分组的置顶 Thread 排在普通 Thread 前面；不提供 Workspace 级置顶区或全局置顶入口，也不重复展示 Thread。
- 2026-07-26: 搜索框为空时最多展示当前范围内 20 个最近活动 Thread，按 Thread Activity Time 从新到旧；输入标题后不设固定结果上限，由结果列表滚动承载全部匹配项。
- 2026-07-26: 打开待处理时只替换中栏，右侧保留当前层级内容；不自动打开第一项，也不新增待处理概览页。
