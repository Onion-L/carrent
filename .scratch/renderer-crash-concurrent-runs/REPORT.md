# Renderer 并发 Run 崩溃排查报告

日期：2026-08-02  
对象：`Carrent 0.0.1-alpha02` / Electron `41.2.2` / macOS arm64

## 结论

这是 **renderer 在反序列化 Main Process 发来的 IPC 消息时发生的 V8 fatal OOM**。不是普通 JS 异常，也没有证据指向 GPU、Skia 或 `node-pty` ABI。

直接触发点已经通过与安装包 UUID 完全匹配的 Electron 官方符号包确认：

```text
partition_alloc::internal::OnNoMemoryInternal
V8OOMErrorCallback
v8::internal::V8::FatalProcessOutOfMemory
v8::internal::HeapAllocator::AllocateRawSlowPath
v8::internal::ValueDeserializer::ReadObjectInternal
v8::internal::ValueDeserializer::ReadDenseJSArray
electron::V8Deserializer::Deserialize
electron::DeserializeV8Value
electron::ElectronApiServiceImpl::Message
```

根因是两个机制叠加：

1. `chatRunAuthority` 每收到一个 Run event，都把所有 Run 的完整 `events[]` 发给每个订阅的 Carrent Window。
2. Kimi 的 message/thinking chunk 被保存为携带“截至当前的完整累计文本”的 timeline event；message chunk 同时还会再保存一份 `delta` event。

因此，对单个连续文本段，Run 历史快照大小是 O(n²)，逐 event 重发完整快照产生的累计序列化量接近 O(n³)。两个并发 Run 提高事件速率并扩大每份快照；多个 Carrent Window 再按订阅者数量放大 IPC。并发不是必要条件，一个足够长的 Run 也可能触发，只是更慢。

置信度：

- “V8 在入站 IPC 反序列化时 OOM”：确定。
- “主要高增长消息是 `chat:changed`”：高。`.ips` 不保存 channel 名，但调用链、嵌套数组形状、发送频率和重启后的行为都与该消息吻合。
- “renderer React 更新是直接 OOM 原因”：否。它会降低消费速度、增加 IPC backlog，是放大因素。

## 证据

### 1. 两份 crash stack 均已符号化为 IPC 反序列化 OOM

安装包中的 Electron Framework UUID：

```text
4C4C44CC-5555-3144-A153-FBA878F2A311
```

Electron `41.2.2` 官方 Breakpad symbol module ID：

```text
4C4C44CC55553144A153FBA878F2A3110
```

二者匹配。两次 crash 的相同地址 `0x55fa580` 均解析为：

```text
partition_alloc::internal::OnNoMemoryInternal(unsigned long) + 32
```

两次调用链差异只在最终失败的字符串分配：

| Incident | 最终分配 | 后续共同路径 |
| --- | --- | --- |
| `01D0D6BE-D10C-4416-8F59-49825FDD8248` | `NewStringFromOneByte` | `ValueDeserializer` -> `ElectronApiServiceImpl::Message` |
| `599FF9FE-A71A-4B8D-8145-70ABC1824A95` | `NewRawTwoByteString` | `ValueDeserializer` -> `ElectronApiServiceImpl::Message` |

栈中连续出现三层 `ReadDenseJSArray`，与 IPC 参数数组内的 `ChatRunAuthorityState.runs[].events[]` 结构一致。第二次直接死在 TwoByte string 分配，也符合历史中包含中文累计文本的情况。

### 2. 已核对实际崩溃安装包，不只依赖当前源码

从已安装应用的 `app.asar` 解包确认，alpha02 实际运行代码包含：

- `currentState()` 复制每个 Run 的完整 `events`。
- `publish()` 对所有 subscriber 发送完整 state。
- Main Process 使用 `contents.send("chat:changed", state)`。
- `agent_message_chunk` 先发累计内容的 `kimi-timeline`，再发当前 chunk 的 `delta`。
- alpha02 没有 `render-process-gone` 文件日志。

当前源码中的对应位置：

- `apps/desktop/electron/chat/chatRunAuthority.ts:72-96,233`
- `apps/desktop/electron/chat/kimiAcpChat.ts:1820-1875`
- `apps/desktop/electron/main.ts:609-613`

### 3. 数据量增长机制

假设一个 message segment 有 `n` 个等长 chunk，每个 chunk 长度为 `c`：

```text
timeline event 1 content = c
timeline event 2 content = 2c
...
timeline event n content = nc
```

仅这些历史 event 保存的字符数就是：

```text
c * (1 + 2 + ... + n) = c * n * (n + 1) / 2 = O(n²)
```

每个 message chunk 又产生 timeline 和 delta 两次 `publish()`；每次发送完整历史，所以一个 subscriber 的累计序列化量接近 O(n³)。`agent_thought_chunk` 也保存累计文本，tool timeline update 同样会重复保存逐步扩大的对象。

此外，`runsByThreadId` 中的 terminal Run 不会被删除。它只会在同一 Thread 开始下一个 Run 时被替换；其他 Thread 的最近 Run 历史会一直进入后续所有广播。

### 4. 定量 harness

使用真实 `createChatRunAuthority`，模拟两个 Run、两个 subscriber、每个 chunk 16 个 ASCII 字符，并用 `node:v8.serialize()` 作为 Electron V8 serialization 的近似测量。该 harness 没有启动真实 Electron，也没有故意把本机 renderer 再次打崩。

| 每个 Run 的 chunk 数 | IPC 发送次数 | 最终 state 序列化大小 | 两个 subscriber 累计序列化量 |
| ---: | ---: | ---: | ---: |
| 50 | 408 | 33,637 B | 5,593,240 B |
| 100 | 808 | 106,787 B | 32,603,840 B |
| 200 | 1,608 | 373,087 B | 214,885,040 B |

chunk 数每次翻倍，累计量分别扩大约 5.8 倍和 6.6 倍，并继续趋近三次方增长。真实 payload 还包含 thinking、tools、permissions、其他 Thread 的 terminal Run，以及 renderer 消费不及时造成的待处理消息。

## 完整因果链

```text
Kimi ACP 高频 chunk
  -> 每个 message chunk 生成累计 timeline event + delta event
  -> chatRunAuthority 将 event append 到无上限 events[]
  -> 每个 event 都构造包含所有 Run 完整历史的 state
  -> 对每个 Carrent Window 执行 contents.send("chat:changed", state)
  -> renderer 消费速度低于生产速度，IPC 消息积压
  -> V8 反序列化下一份大 state 时无法分配 string / array
  -> FatalProcessOutOfMemory -> SIGTRAP / EXC_BREAKPOINT
```

renderer 的 observe path 会逐 event 执行 `updateMessageParts` 和 `updateMessageRunEventCount`，造成频繁 React state replacement。App State 持久化有 250ms debounce，所以它不是同频率的主要发送源，但本地更新仍会拖慢 `chat:changed` 的消费。

## 第二次 9 秒内崩溃的解释

两份报告的 `parentPid` 都是 `21130`，说明 Carrent Main Process 没有重启；只有 renderer 从 `21145` 变为 `41147`。因此这不是 Carrent Window session restore，也不是从磁盘恢复 Run。

Main Process 中的 `chatRunAuthority` 和完整 Run 历史仍然存活。新 renderer 建立 chat listener 并调用 `chat.subscribe()` 后，会立即接收已有完整 state；与此同时 live Run 还可能继续广播。第二次 crash 仍落在同一 IPC deserializer，符合重新订阅后很快再次收到超大历史的行为。

`.ips` 不能判断新 renderer 是 Chromium 自动重建、用户 reload，还是其他窗口生命周期动作；只能确定 Main Process 未退出。原 ISSUE 中“auto-restart”和“session restore replays histories”表述过强。

## 排除和降级的假设

| 假设 | 结论 | 依据 |
| --- | --- | --- |
| GPU / Skia / Metal CHECK | 排除为本次直接原因 | 符号栈完整落在 V8 IPC deserializer OOM，无 GPU frame |
| `node-pty` ABI / native 初始化 | 排除 | 两次都发生在 renderer 入站 Message，第一次已运行约 56 分钟 |
| renderer React state leak 单独导致 | 降级为放大因素 | 最终分配点是 IPC payload deserialize；频繁更新会降低消费吞吐 |
| terminal output 无上限 | 与本次 crash 无直接证据 | terminal event 没有 `runs[].events[]` 的嵌套数组形状，且是定向单窗口消息 |
| `deliveredEventCountByRunId` 未清理 | 存在但不是主因 | Map 每个 Run 只有一个 number，量级不足以解释这次 OOM |

## 对原 ISSUE 的修正

1. `bug_type 309 + SIGTRAP` 本身不能证明 OOM；真正的证明来自匹配 UUID 后的符号化栈。
2. `1.4 TB` VM reservation 和 region count 不应作为主要因果证据。它不是 RSS，也无法单独区分正常 Chromium reservation 与泄漏。
3. 增长不只是“完整事件历史导致 O(n²) 累计发送”。累计 timeline event 让单份历史本身达到 O(n²)，逐 event 全量发送接近 O(n³)。
4. 第二次崩溃不是应用级 session restore；是同一个 Main Process 下的新 renderer 收到仍驻留内存的 Run state。
5. 当前分支已经在提交 `02c9a5e` 增加 `render-process-gone` 和文件 logger；这正是写 ISSUE 的提交。崩溃时的 alpha02 安装包确实没有该能力，但“当前代码完全无 observability”已经不成立。
6. 当前 `apps/desktop/package.json` 仍是 `0.0.1-alpha02`，不存在 ISSUE 所述的 alpha03 未提交 version bump。

## 修复建议

### P0

1. 将 live fan-out 改成 revisioned delta：每次只发 `{ revision, runId, event }`，完整 snapshot 只用于首次订阅或明确 resync。保持 Main Process authority，不违反 ADR-0012。
2. 改变 timeline event 语义，禁止每个 chunk 保存完整累计文本。message/thinking 应分别使用 start + append delta，tool update 使用 patch；不要同时保存累计 timeline message 和重复的 `delta`。
3. reconnect snapshot 必须是 compact state，而不是原始累计 event log。按字节设置硬上限，并在 Run terminal、内容成功持久化后清理 replay history。
4. 在发送前增加 payload byte guard。超限时应停止继续广播并让 Run 以可见错误结束，不能让 renderer OOM。该 guard 是保护措施，不能代替协议修复。

### P1

1. Main Process 按 16-50ms 批量发送 event delta，避免 token burst 形成大量待处理 IPC task。
2. renderer 按 frame 或 microtask 批量应用 delta、timeline patch 和 `runEventCount`，减少 React state replacement。
3. 清理 terminal Run、`threadIdByRunId` 和 `deliveredEventCountByRunId` 的长期条目。

### 验证标准

1. Authority benchmark：chunk 数翻倍时，累计发送字节最多近似 2 倍，不能再接近 8 倍。
2. Electron 集成测试：两个 Run、两个 Carrent Window 持续流式输出，记录 renderer heap、单条 IPC payload bytes 和 backlog；长时间运行不增长失控。
3. Renderer reload 测试：live Run 中 reload 任一 Carrent Window，只接收 compact snapshot + watermark，不能重放无上限原始历史。
4. 回归测试同时覆盖 message、thinking 和持续更新的 tool output；只测短 delta event 不足以覆盖这次问题。
5. 复测时检查 Main Process 诊断日志中的 `render-gone` reason，并保留匹配版本的 Crashpad/Breakpad symbols。
