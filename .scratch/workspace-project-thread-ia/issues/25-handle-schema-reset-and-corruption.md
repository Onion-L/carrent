# 25 — 处理 schema 重置与 App State 损坏

**What to build:** 完成三层 App State 的版本、验证和恢复边界。Carrent 对已知旧开发数据执行受限重置，对未知 schema 保留并阻塞，对当前 schema 的缺失、部分写入或引用损坏提供全局诊断、重新读取和经确认的完整重置。

**Blocked by:** 17 — 添加跨 Workspace 待处理视图；18 — 添加分层 Thread 搜索；20 — 添加 Association 与 Workspace 级联移除；22 — 处理 Project 目录不可用与重新定位；23 — 处理附件缺失与孤立数据；24 — 固定 Main Window 与重启生命周期

**Status:** ready-for-agent

- [ ] 目标 App State 使用一个显式支持的 schema，并完整验证 Workspace、Project、Association、Thread 及所有持久化交叉引用。
- [ ] 持久化层区分从未初始化/成功重置与已建立状态意外缺失；前者进入首次使用，后者进入全局损坏恢复。
- [ ] 检测到明确识别的旧开发 schema 时，无备份、无确认地清理 Carrent-owned 旧 App State、Runtime Session 映射、附件存储和旧 projectless Chat 内部目录。
- [ ] 已知旧数据重置不扫描或修改 Project Working Directory、项目文件、Git 状态或旧 Carrent private refs；成功后创建空三层状态并显示一次提示。
- [ ] 任一旧数据清理或新状态写入失败时中止初始化，不暴露半旧半新的状态。
- [ ] 未知 schema 保留原文件、阻止数据层启动且绝不自动清空；不提供隐式迁移、导入或导出。
- [ ] 当前 schema 的 malformed JSON、部分写入、无效记录或内部引用不一致采用 all-or-nothing 验证，不展示部分可解析数据。
- [ ] 全局损坏状态阻止正常导航、Run 和所有数据写入，只提供“重新读取”“复制诊断信息”和“完整重置”。
- [ ] 重新读取成功后在当前 Main Window 恢复并按既定位置规则 replace；完整重置二次确认后删除 Carrent app data，进入首次使用并显示一次提示。
- [ ] 完整重置确认明确 Project Working Directory、项目文件、Git 状态和 private refs 不受影响；重置失败继续阻塞并追加诊断。
- [ ] 复制诊断可包含应用版本、故障区域、阶段、摘要、数据路径、时间和相关稳定 ID，但不得包含消息、Draft、附件内容或 Provider 配置。
- [ ] Workspace Store + IPC 测试覆盖 round-trip、原子写入、文件系统故障注入、旧/未知 schema、意外缺失、重新读取和完整重置；Mounted App 测试覆盖阻塞界面及恢复落点。
