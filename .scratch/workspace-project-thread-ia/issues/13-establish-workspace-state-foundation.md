# 13 — 建立 Workspace 三层状态基础

**What to build:** 建立可与旧扁平模型暂时并存的新三层 App State 路径，让用户可以从首次使用状态创建、重命名和切换 Workspace，并在重启后恢复这些 Workspace。该切片同时提供基础 Workspace 概览和现有三栏框架中的 Workspace 切换入口，为后续 Project、Thread 和旧模型迁移提供稳定扩展点。

**Blocked by:** None — can start immediately

**Status:** done

- [ ] 首次启动且没有已初始化三层状态时显示全局首次使用界面，只要求输入 Workspace 名称并提供创建动作。
- [ ] Workspace 使用稳定 ID、非空且不区分大小写唯一的名称和稳定用户排序；创建后追加到末尾并打开其概览。
- [ ] 用户可以重命名 Workspace，名称校验与创建一致，重命名不改变 Workspace ID 或排序。
- [ ] 左侧固定栏可以显示、创建和切换 Workspace；重复选择当前 Workspace 不改变当前页面。
- [ ] 空 Workspace 是合法状态，其概览可独立显示且不依赖任何 Project 或 Thread。
- [ ] 新三层 App State 可以通过现有 preload/IPC 持久化边界保存并在重启后恢复，写入前会完整校验当前切片拥有的数据。
- [ ] 新状态接口与旧扁平状态暂时并存，未迁移的现有页面和测试继续可构建、可运行。
- [ ] Renderer 挂载测试覆盖首次使用、创建、重命名、切换和重启恢复；持久化测试覆盖有效 round-trip 与无效 Workspace 数据拒绝。
