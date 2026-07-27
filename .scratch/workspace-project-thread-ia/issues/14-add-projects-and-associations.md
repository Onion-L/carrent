# 14 — 在 Workspace 中添加和复用 Project

**What to build:** 让用户从 Workspace 添加 Project Working Directory，并通过 Workspace-Project Association 在多个 Workspace 之间复用同一 Project。用户可以管理 Workspace 内别名、共享 Project 名称、稳定排序和新 Thread 默认运行配置，Carrent 始终保留目录的用户所有权。

**Blocked by:** 13 — 建立 Workspace 三层状态基础

**Status:** done

- [ ] 空 Workspace 概览显示“添加 Project”主动作，并说明 Carrent 不会移动或复制所选目录。
- [ ] 选择首次出现的目录时，Carrent 原子创建一个稳定 Project 和当前 Workspace 的 Association，然后打开 Project 概览。
- [ ] 选择已知目录时复用既有 Project；当前 Workspace 缺少 Association 时只创建 Association，已有时直接打开且不重复创建。
- [ ] 同一个规范化 Project Working Directory 只能对应一个 Project；不同路径即使来自同一 Git remote 也保持为不同 Project。
- [ ] Project 具有共享名称和稳定 ID；Association 具有 Workspace 内可选别名与稳定排序，清空别名恢复共享名称。
- [ ] Workspace 内重命名只修改 Association 别名；Project 设置中的共享重命名明确提示会影响全部关联 Workspace。
- [ ] 新 Association 使用 Primary Runtime、不指定模型和 Approval Required 作为新 Thread 默认配置，且不同 Association 可以独立修改默认值。
- [ ] Project Working Directory 不需要是 Git 仓库，Carrent 不复制、移动、删除或修改所选目录。
- [ ] Mounted Renderer 测试覆盖首次添加、跨 Workspace 复用、重复添加、别名/共享名称和默认配置；持久化测试覆盖 Project 与 Association 引用不变量。
