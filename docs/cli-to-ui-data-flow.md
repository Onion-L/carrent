# CLI 运行时输出到 Desktop UI 的数据流

本文档描述 Carrent 桌面应用中，外部 CLI 运行时（如 Kimi Code）的输出如何经过 Electron 进程间通信（IPC），最终呈现在用户界面上的完整链路。

## 1. 为什么需要 IPC

Electron 应用由多个独立进程组成：

| 进程 | 职责 | 典型操作 |
|---|---|---|
| **Main 进程** | 后台主进程 | 启动 CLI 子进程、读写文件、访问系统 API |
| **Renderer 进程** | 前端页面进程 | 渲染 React UI、响应用户交互 |

这两个进程拥有独立的内存空间，不能直接共享变量或对象。它们必须通过 **IPC（Inter-Process Communication，进程间通信）** 发送消息来协同工作。

在 Carrent 中，IPC 是 CLI 输出能够实时显示在桌面窗口上的唯一通道。

## 2. IPC 频道命名

Electron 本身不强制频道名格式，唯一要求是**发送方和接收方使用完全相同的字符串**。Carrent 按业务模块给频道加了前缀：

| 频道名 | 方向 | 用途 |
|---|---|---|
| `chat:send` | Renderer → Main | 发送一条 Agent 请求 |
| `chat:stop` | Renderer → Main | 停止当前 run |
| `chat:permission-response` | Renderer → Main | 用户响应权限请求 |
| `chat:kimi-status` | Renderer → Main | 查询 Kimi 运行状态 |
| `chat:event` | Main → Renderer | 运行时事件流（文本/reasoning/shell/结束等） |
| `workspace:load` | Renderer → Main | 加载 workspace 数据 |
| `workspace:save` | Renderer → Main | 保存 workspace 数据 |
| `attachment:store` | Renderer → Main | 存储附件 |

`chat:` 前缀表示这些频道属于**聊天 / Agent Run** 这个业务模块。

## 3. 端到端数据流

```
┌────────────────────────────────────────────────────────────────────────┐
│                         CLI → UI 数据链路                              │
└────────────────────────────────────────────────────────────────────────┘

  用户提交
  ┌──────────────┐
  │  Composer.tsx│
  └──────┬───────┘
         │ window.carrent.chat.send()
         ▼
┌────────────────────────────────────────────────┐
│           Electron Main Process                │
│  ┌────────────────────────────────────────┐    │
│  │ chat:send handler  (chatIpc.ts)        │    │
│  └───────────────┬────────────────────────┘    │
│                  │                              │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ ChatSessionManager.start()             │    │
│  │  (chatSessionManager.ts)               │    │
│  └───────────────┬────────────────────────┘    │
│                  │ spawn child_process           │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │  kimi acp  (stdio JSON-RPC)            │    │
│  │  or claude / codex (NDJSON)            │    │
│  └───────────────┬────────────────────────┘    │
│                  │ stdout line                   │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ Provider parser: KimiAcpRun /          │    │
│  │ consumeClaudeStreamChunk /             │    │
│  │ consumeCodexStreamChunk                │    │
│  └───────────────┬────────────────────────┘    │
│                  │ ChatRunEvent                  │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ emitChatEvent(event)  (main.ts)        │    │
│  └───────────────┬────────────────────────┘    │
└──────────────────┼─────────────────────────────┘
                   │ webContents.send("chat:event")
                   ▼
┌────────────────────────────────────────────────┐
│           Electron Renderer Process            │
│  ┌────────────────────────────────────────┐    │
│  │ preload.ts: window.carrent.chat.onEvent│    │
│  └───────────────┬────────────────────────┘    │
│                  │                              │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ useChatRun.ts + chatRunCoordinator     │    │
│  │   接收并路由事件到对应 run 的回调        │    │
│  └───────────────┬────────────────────────┘    │
│                  │ onDelta / onReasoning /      │
│                  │ onShell / onComplete / ...   │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ WorkspaceContext.tsx                   │    │
│  │ updateMessageParts /                   │    │
│  │ updateMessageRunStatus                 │    │
│  └───────────────┬────────────────────────┘    │
│                  │ messages 状态                │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ ChatPage.tsx / ThreadPage.tsx          │    │
│  │ getChatRouteData(threadId)             │    │
│  └───────────────┬────────────────────────┘    │
│                  │ messages                     │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ MessageTimeline.tsx                    │    │
│  │  UserMessage / AssistantMessage        │    │
│  └───────────────┬────────────────────────┘    │
│                  │ parts[]                      │
│                  ▼                              │
│  ┌────────────────────────────────────────┐    │
│  │ • AgentActivityBlock.tsx               │    │
│  │   - ReasoningStepItem                  │    │
│  │   - ShellStepItem                      │    │
│  │ • MarkdownContent.tsx                  │    │
│  │ • ChangedFilesCard.tsx                 │    │
│  └────────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```

### 3.1 用户提交

`Composer.tsx` 收集用户输入、附件、skill、runtime/model/mode，然后调用：

```ts
const { send, stop, respondToPermission } = useChatRun();
send(request, callbacks);
```

### 3.2 进入 Main 进程

`useChatRun.ts` 调用 `window.carrent.chat.send(request)`。`preload.ts` 把它映射到：

```ts
ipcRenderer.invoke("chat:send", request)
```

Main 进程在 `chatIpc.ts` 中注册了对应的处理函数：

```ts
ipcMain.handle("chat:send", async (_event, request: ChatTurnRequest) => {
  // 启动 ChatSessionManager
});
```

### 3.3 启动 CLI 子进程

`ChatSessionManager.start()` 根据 `request.runtimeId` 选择启动方式：

- **Kimi**: `kimi acp`，stdio JSON-RPC 2.0，一行一个 JSON 对象。
- **Claude**: `claude-code --print --output-format stream-json ...`
- **Codex**: `codex exec --json ...`

这些 CLI 都是 Node.js 的 `child_process.spawn()` 启动的，stdout 被管道捕获。

### 3.4 解析 CLI 原始输出

子进程 stdout 按行读取并 JSON 解析，由 provider 专属的解析器处理：

- Kimi: `KimiAcpRun.handleSessionUpdate` / `handleToolUpdate` (`kimiAcpChat.ts`)
- Claude: `consumeClaudeStreamChunk` (`chatSessionManager.ts`)
- Codex: `consumeCodexStreamChunk` (`chatSessionManager.ts`)

### 3.5 标准化为 `ChatRunEvent`

所有 provider 的输出被统一成内部事件类型，定义在 `apps/desktop/src/shared/chat.ts`：

```ts
export type ChatRunEvent =
  | { type: "thread-upserted"; runId: string; ... }
  | { type: "started"; runId: string; threadId: string }
  | { type: "delta"; runId: string; text: string }
  | { type: "reasoning"; runId: string; reasoning: ChatReasoningEventPayload }
  | { type: "shell"; runId: string; shell: ChatShellEventPayload }
  | { type: "completed"; runId: string; text: string; finishedAt: string }
  | { type: "failed"; runId: string; error: string }
  | { type: "stopped"; runId: string }
  | { type: "permission-requested"; runId: string; permission: ChatPermissionRequest }
  | { type: "permission-resolved"; runId: string; permissionId: string; decision: ChatPermissionDecision }
  | { type: "permission-failed"; runId: string; permissionId: string; error: string };
```

| CLI 原始内容 | 标准化事件 | 含义 |
|---|---|---|
| 助手文本片段 | `delta` | 要追加到回答里的文字 |
| reasoning / thinking | `reasoning` | 模型的中间思考过程 |
| shell 命令 / 输出 | `shell` | 工具执行的命令与结果 |
| 权限请求 | `permission-requested` | 运行时请求用户批准某项操作 |
| 运行结束 | `completed` / `failed` / `stopped` | run 的最终状态 |
| 线程更新 | `thread-upserted` | 运行中创建的草稿线程 |

### 3.6 IPC 广播到 Renderer

`main.ts` 中的 `emitChatEvent` 向所有窗口广播事件：

```ts
const emitChatEvent = (event: unknown) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("chat:event", event);
  });
};
```

这保证了即使打开多个窗口，也能同时收到同一条运行时事件。

### 3.7 Renderer 接收并路由

`preload.ts` 暴露给前端的 API：

```ts
chat: {
  send: (request) => ipcRenderer.invoke("chat:send", request),
  stop: (runId) => ipcRenderer.invoke("chat:stop", runId),
  respondToPermission: (response) => ipcRenderer.invoke("chat:permission-response", response),
  getKimiStatus: (request) => ipcRenderer.invoke("chat:kimi-status", request),
  onEvent: (listener) => {
    const wrapped = (_event, evt) => listener(evt);
    ipcRenderer.on("chat:event", wrapped);
    return () => ipcRenderer.removeListener("chat:event", wrapped);
  },
}
```

`useChatRun.ts` 注册监听器并维护一个 `chatRunCoordinator`：

```ts
window.carrent.chat.onEvent((event) => chatRunCoordinator.handleEvent(event));
```

`chatRunCoordinator` 根据 `runId` 把事件路由到 `Composer.tsx` 在 `send()` 时传入的回调。

### 3.8 React 状态更新

`Composer.tsx` 的回调更新 `WorkspaceContext` 里的消息状态：

| 事件 | 状态操作 |
|---|---|
| `delta` | `updateMessageParts(..., { kind: "append-text" })` |
| `reasoning` | `updateMessageParts(..., { kind: "upsert-reasoning" })` |
| `shell` | `updateMessageParts(..., { kind: "upsert-shell" })` |
| `completed` | `updateMessageRunStatus(assistantMsg.id, "completed")` |
| `failed` | 追加错误文本，状态设为 `failed` |
| `stopped` | 追加 `[Stopped]`，状态设为 `cancelled` |

`WorkspaceContext` 维护每个 `Message` 的 `parts[]` 数组，一个消息可以由多个 `text`、`reasoning`、`shell` 部分组成。

### 3.9 UI 渲染

`ChatPage.tsx` / `ThreadPage.tsx` 通过 `useWorkspace().getChatRouteData(threadId)` 拿到消息列表，传给 `MessageTimeline.tsx`。

`MessageTimeline` 根据 `message.parts` 分发渲染：

- `reasoning` / `shell` → `AgentActivityBlock.tsx`（可折叠的 "Thinking" 区域）
  - `ReasoningStepItem`：显示 reasoning 内容与状态
  - `ShellStepItem`：显示命令、输出、退出码
- `text` → `MarkdownContent.tsx`（`react-markdown` 渲染）
- 文件变更类消息 → `ChangedFilesCard.tsx`

## 4. 一句话总结

> CLI 的 stdout 被 Main 进程实时解析成统一事件，通过 `chat:event` IPC 推给 Renderer；React 把事件写进消息状态，最后由 `MessageTimeline` 根据消息类型渲染成文字、思考过程、终端输出或文件变更卡片。

## 5. 相关文件索引

| 文件 | 职责 |
|---|---|
| `apps/desktop/electron/main.ts` | 注册 IPC、广播 `chat:event` |
| `apps/desktop/electron/chat/chatIpc.ts` | `chat:send` / `chat:stop` 等 IPC handler |
| `apps/desktop/electron/chat/chatSessionManager.ts` | 启动 CLI、provider 输出解析、生命周期管理 |
| `apps/desktop/electron/chat/kimiAcpChat.ts` | Kimi `kimi acp` JSON-RPC 传输与解析 |
| `apps/desktop/electron/preload.ts` | 暴露 `window.carrent.chat.*` API 给 Renderer |
| `apps/desktop/src/shared/chat.ts` | `ChatTurnRequest`、`ChatRunEvent` 等共享类型 |
| `apps/desktop/src/renderer/hooks/useChatRun.ts` | Renderer 侧事件监听与 run 协调 |
| `apps/desktop/src/renderer/context/WorkspaceContext.tsx` | 消息状态管理与持久化 |
| `apps/desktop/src/renderer/components/chat/Composer.tsx` | 用户输入与发送逻辑 |
| `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx` | 消息列表渲染 |
| `apps/desktop/src/renderer/components/chat/AgentActivityBlock.tsx` | reasoning / shell 活动块 |
| `apps/desktop/src/renderer/components/chat/MarkdownContent.tsx` | 文本内容 markdown 渲染 |
| `apps/desktop/src/renderer/components/chat/ChangedFilesCard.tsx` | 文件变更卡片 |
