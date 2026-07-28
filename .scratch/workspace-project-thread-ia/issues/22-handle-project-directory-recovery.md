# 22 — 处理 Project 目录不可用与重新定位

**What to build:** 当 Project Working Directory 缺失或移动时，在保留 Workspace、Project、Thread 历史与层级上下文的前提下阻止错误 Run，并允许用户再次检查或明确重新定位同一个 Project。

**Blocked by:** 16 — 完成三层导航与位置恢复；21 — 隔离 Runtime Session 连续性故障

**Status:** done

- [ ] Carrent 检测记录目录是否可用，但不搜索、猜测或自动采用其他路径，Project 身份在目录不可用时保持不变。
- [ ] 不可用 Project 在中栏 Project 项显示警告，当前 Project/Thread 右侧内容替换为局部错误状态并保留完整层级导航。
- [ ] 错误状态显示记录路径，说明历史仍保留但不能启动新 Run，并提供“再次检查”和“重新定位目录”。
- [ ] 再次检查成功后以 replace 返回触发错误前的位置；失败继续留在当前状态。
- [ ] 重新定位要求该 Project 没有 live Run，并拒绝已绑定其他 Project 的目标目录。
- [ ] 成功重新定位原子更新共享 Project 路径，使全部 Association 和 Thread 的后续 Run 使用新目录，并解除该 Project 的全部 Runtime Session。
- [ ] 取消、校验失败、Runtime Session 清理失败或路径写入失败均保留旧路径与完整原状态。
- [ ] 重新定位和不可用状态从不移动、复制或编辑目录内容和 Git 状态。
- [ ] Renderer 测试覆盖局部状态、Run 阻塞、检查/定位落点；持久化和 Runtime 测试覆盖原子更新、映射解除及失败回滚。
