# 17 — 添加跨 Workspace 待处理视图

**What to build:** 在左侧 Workspace 栏提供应用级待处理入口，跨所有 Workspace 聚合真正需要用户介入的 Thread，并让用户从临时中栏列表进入正常三层导航后可通过 Back 返回原有待处理位置。

**Blocked by:** 16 — 完成三层导航与位置恢复

**Status:** done

- [ ] 左栏顶部提供固定待处理入口和数量徽标，数量只包含等待批准、等待回答和 Failed Thread。
- [ ] 打开待处理只临时替换中栏，右侧当前 Workspace、Project 或 Thread 内容保持不变，不自动选择第一项或增加独立概览页。
- [ ] 列表依次按等待批准、等待回答和 Failed 分组，组内按 Thread Activity Time 从新到旧排序。
- [ ] 每项显示 Workspace / Project 路径；置顶不改变待处理排序。
- [ ] Running、最近活动、置顶、搜索结果、Archived Thread 和 Thread Draft 不进入待处理视图。
- [ ] 从待处理打开 Thread 会退出临时视图、选择所属 Workspace 并进入正常三栏导航，同时新增浏览历史。
- [ ] Back 恢复待处理列表原有分组、滚动位置和选中项。
- [ ] 空待处理状态只替换中栏列表区域，说明会出现的状态，不改变右侧内容或提供多余动作。
- [ ] Thread Status 优先级和 Failed 保留规则在待处理计数、分组及普通导航项上保持一致。
- [ ] Mounted Renderer 测试覆盖聚合范围、排序、计数、跳转、Back 恢复和空状态。
