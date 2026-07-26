# 决定三层持久化损坏与版本不匹配的恢复体验

Type: grilling
Status: open
Blocked by: 07, 09

## Question

目标三层 schema 投入使用后，如果显式支持版本的 App State Snapshot、Runtime Session 映射或附件数据出现缺失、部分写入、格式损坏或引用不一致，Carrent 应阻止哪些能力、允许哪些只读访问，并向用户提供重试、导出、导入、移除 Runtime Session、丢弃孤立附件或完整重置中的哪些恢复动作；同时明确遇到未知更旧或更新 schema 时的阻塞界面、诊断信息和恢复后落点，不得重新引入对当前旧开发版数据的迁移承诺。
