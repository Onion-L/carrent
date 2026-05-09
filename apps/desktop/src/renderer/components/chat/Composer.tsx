import { AlertTriangle, ArrowUp, ChevronDown, Lock, Pencil, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDraftThread } from "../../context/DraftThreadContext";
import {
  TYPEWRITER_INTERVAL_MS,
  getNextTypewriterText,
  hasPendingTypewriterText,
} from "./typewriter";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useChatRun } from "../../hooks/useChatRun";
import type { Message } from "../../mock/uiShellData";
import { type ChatReasoningEventPayload, type ChatShellEventPayload } from "../../../shared/chat";
import {
  DEFAULT_RUNTIME_MODE,
  getRuntimeModeLabel,
  type RuntimeMode,
} from "../../../shared/runtimeMode";
import { runtimeNameMap, type RuntimeId } from "../../../shared/runtimes";
import { RuntimeIcon } from "../RuntimeIcon";
import { useRuntimes } from "../../hooks/useRuntimes";
import { getChatRuntimeOptions, isChatRuntimeAvailable } from "../../lib/runtimeSelection";

function RuntimeModeIcon({ mode, className }: { mode: RuntimeMode; className?: string }) {
  switch (mode) {
    case "approval-required":
      return <Lock className={className} />;
    case "auto-accept-edits":
      return <Pencil className={className} />;
    case "full-access":
      return <AlertTriangle className={className} />;
  }
}

type ComposerProps =
  | {
      mode: "draft";
      draftId: string;
      projectId: string;
      title: string;
      preallocatedThreadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
    }
  | {
      mode: "thread";
      projectId: string;
      threadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
    }
  | {
      mode: "chat";
      threadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
    };

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function createMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildTextMessage(threadId: string, role: "user" | "assistant", content: string): Message {
  return {
    id: createMessageId(),
    role,
    threadId,
    content,
    timestamp: formatTime(new Date()),
    type: "text",
  };
}

type ComposerKeyDownEvent = {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  nativeEvent: {
    isComposing?: boolean;
  };
};

export function shouldSubmitComposerOnKeyDown(event: ComposerKeyDownEvent) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  );
}

export function Composer(props: ComposerProps) {
  const { projects, chats, appendMessage, updateMessage, updateMessageParts, upsertChat } =
    useWorkspace();
  const { appendDraftMessage, updateDraftMessage, updateDraftMessageParts } = useDraftThread();
  const { runningThreadIds, send, stop } = useChatRun();
  const { runtimes, loading: runtimesLoading } = useRuntimes();
  const [input, setInput] = useState("");
  const [showRuntimePicker, setShowRuntimePicker] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const receivedTextRef = useRef("");
  const visibleTextRef = useRef("");
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const flushTypewriterRef = useRef<VoidFunction | null>(null);
  const projectId = props.mode === "chat" ? null : props.projectId;
  const project = projectId ? (projects.find((item) => item.id === projectId) ?? null) : null;
  const threadId = props.mode === "draft" ? props.preallocatedThreadId : props.threadId;
  const messagesLength = props.messages.length;
  const onRuntimeIdChange = props.onRuntimeIdChange;
  const runtimeOptions = useMemo(() => getChatRuntimeOptions(runtimes), [runtimes]);
  const isSelectedRuntimeAvailable = isChatRuntimeAvailable(props.runtimeId, runtimes);
  const runtimeHint = runtimesLoading
    ? "Checking runtimes..."
    : runtimeOptions.length === 0
      ? "No enabled runtime"
      : isSelectedRuntimeAvailable
        ? null
        : "Select an available runtime";

  const canSend =
    (props.mode === "chat" ? !!input.trim() : !!input.trim() && !!project) &&
    isSelectedRuntimeAvailable;
  const isThreadSending = runningThreadIds.includes(threadId);

  const stopTypewriter = () => {
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
  };

  const flushActiveTypewriter = () => {
    stopTypewriter();
    flushTypewriterRef.current?.();
  };

  useEffect(() => {
    return () => {
      flushActiveTypewriter();
    };
  }, []);

  useEffect(() => {
    if (
      runtimesLoading ||
      messagesLength > 0 ||
      isSelectedRuntimeAvailable ||
      runtimeOptions.length === 0 ||
      !onRuntimeIdChange
    ) {
      return;
    }

    onRuntimeIdChange(runtimeOptions[0].id);
  }, [
    isSelectedRuntimeAvailable,
    messagesLength,
    onRuntimeIdChange,
    runtimeOptions,
    runtimesLoading,
  ]);

  const handleSend = async () => {
    if (!canSend) return;

    const messageText = input.trim();
    setInput("");

    const appendLocalMessage = (role: "user" | "assistant", content: string) => {
      if (props.mode === "thread" || props.mode === "chat") {
        return appendMessage({
          threadId,
          role,
          content,
        });
      }

      const draftMessage = buildTextMessage(threadId, role, content);
      appendDraftMessage(props.draftId, draftMessage);
      return draftMessage;
    };

    const updateLocalMessage = (messageId: string, content: string) => {
      if (props.mode === "thread" || props.mode === "chat") {
        updateMessage(messageId, content);
        return;
      }

      updateDraftMessage(props.draftId, messageId, content);
      updateMessage(messageId, content);
    };

    const updateLocalMessageTextPart = (messageId: string, content: string) => {
      if (!content) {
        return;
      }

      if (props.mode === "thread" || props.mode === "chat") {
        updateMessageParts(messageId, {
          kind: "append-text",
          content,
        });
        return;
      }

      updateDraftMessageParts(props.draftId, messageId, {
        kind: "append-text",
        content,
      });
      updateMessageParts(messageId, {
        kind: "append-text",
        content,
      });
    };

    const updateLocalMessageShellPart = (messageId: string, shell: ChatShellEventPayload) => {
      if (props.mode === "thread" || props.mode === "chat") {
        updateMessageParts(messageId, {
          kind: "upsert-shell",
          shell: {
            type: "shell",
            ...shell,
          },
        });
        return;
      }

      updateDraftMessageParts(props.draftId, messageId, {
        kind: "upsert-shell",
        shell: {
          type: "shell",
          ...shell,
        },
      });
      updateMessageParts(messageId, {
        kind: "upsert-shell",
        shell: {
          type: "shell",
          ...shell,
        },
      });
    };

    const updateLocalMessageReasoningPart = (
      messageId: string,
      reasoning: ChatReasoningEventPayload,
    ) => {
      if (props.mode === "thread" || props.mode === "chat") {
        updateMessageParts(messageId, {
          kind: "upsert-reasoning",
          reasoning: {
            type: "reasoning",
            ...reasoning,
          },
        });
        return;
      }

      updateDraftMessageParts(props.draftId, messageId, {
        kind: "upsert-reasoning",
        reasoning: {
          type: "reasoning",
          ...reasoning,
        },
      });
      updateMessageParts(messageId, {
        kind: "upsert-reasoning",
        reasoning: {
          type: "reasoning",
          ...reasoning,
        },
      });
    };

    const flushPendingTypewriterText = () => {
      const activeMessageId = activeAssistantMessageIdRef.current;
      if (!activeMessageId) {
        return;
      }

      if (visibleTextRef.current !== receivedTextRef.current) {
        const nextText = receivedTextRef.current;
        const delta = nextText.slice(visibleTextRef.current.length);
        visibleTextRef.current = nextText;
        updateLocalMessageTextPart(activeMessageId, delta);
      }
    };

    const startTypewriter = (messageId: string) => {
      activeAssistantMessageIdRef.current = messageId;

      if (typewriterTimerRef.current) {
        return;
      }

      typewriterTimerRef.current = setInterval(() => {
        const nextVisibleText = getNextTypewriterText(
          visibleTextRef.current,
          receivedTextRef.current,
        );

        if (nextVisibleText !== visibleTextRef.current) {
          const delta = nextVisibleText.slice(visibleTextRef.current.length);
          visibleTextRef.current = nextVisibleText;
          updateLocalMessageTextPart(messageId, delta);
        }

        if (!hasPendingTypewriterText(visibleTextRef.current, receivedTextRef.current)) {
          stopTypewriter();
        }
      }, TYPEWRITER_INTERVAL_MS);
    };

    appendLocalMessage("user", messageText);
    const assistantMsg = appendLocalMessage("assistant", "");

    flushActiveTypewriter();
    receivedTextRef.current = "";
    visibleTextRef.current = "";
    activeAssistantMessageIdRef.current = assistantMsg.id;
    flushTypewriterRef.current = () => {
      const activeMessageId = activeAssistantMessageIdRef.current;
      if (!activeMessageId) {
        return;
      }

      flushPendingTypewriterText();

      activeAssistantMessageIdRef.current = null;
      flushTypewriterRef.current = null;
    };

    const transcript = props.messages
      .filter((m) => m.type !== "changed_files")
      .slice(-6)
      .map((m) => ({
        role: m.role,
        content: m.content ?? "",
      }));

    if (props.mode === "chat") {
      const chatThread = chats.find((c) => c.id === threadId);
      if (chatThread && chatThread.title === "New chat") {
        upsertChat({ ...chatThread, title: messageText.slice(0, 60) });
      }
    }

    await send(
      {
        workspace:
          props.mode === "chat"
            ? { kind: "chat" }
            : {
                kind: "project",
                projectId: props.projectId,
                projectPath: project!.path,
              },
        threadId,
        draftRef:
          props.mode === "draft"
            ? {
                draftId: props.draftId,
                projectId: props.projectId,
                title: props.title,
              }
            : undefined,
        runtimeId: props.runtimeId,
        runtimeMode: props.runtimeMode,
        transcript,
        message: messageText,
      },
      {
        onDelta: (text) => {
          receivedTextRef.current += text;
          startTypewriter(assistantMsg.id);
        },
        onReasoning: (reasoning) => {
          stopTypewriter();
          flushPendingTypewriterText();
          updateLocalMessageReasoningPart(assistantMsg.id, reasoning);
        },
        onShell: (shell) => {
          stopTypewriter();
          flushPendingTypewriterText();
          updateLocalMessageShellPart(assistantMsg.id, shell);
        },
        onComplete: (text) => {
          if (!receivedTextRef.current || text.startsWith(receivedTextRef.current)) {
            receivedTextRef.current = text;
          }
          startTypewriter(assistantMsg.id);
        },
        onError: (error) => {
          stopTypewriter();
          updateLocalMessage(assistantMsg.id, `Error: ${error}`);
          activeAssistantMessageIdRef.current = null;
          flushTypewriterRef.current = null;
        },
        onStop: () => {
          stopTypewriter();
          updateLocalMessage(
            assistantMsg.id,
            `${receivedTextRef.current || visibleTextRef.current}\n\n[Stopped]`,
          );
          activeAssistantMessageIdRef.current = null;
          flushTypewriterRef.current = null;
        },
      },
    );
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-border bg-surface p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message..."
            className="w-full resize-none bg-transparent text-[14px] text-fg placeholder:text-subtle outline-none"
            rows={2}
            onKeyDown={(e) => {
              if (shouldSubmitComposerOnKeyDown(e)) {
                e.preventDefault();
                if (canSend && !isThreadSending) {
                  handleSend();
                }
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {props.onRuntimeIdChange ? (
                <div className="relative">
                  <button
                    onClick={() => {
                      if (!isThreadSending) {
                        setShowRuntimePicker((v) => !v);
                      }
                    }}
                    disabled={isThreadSending}
                    className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-raised px-2.5 py-1 text-[11px] text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                    title={isThreadSending ? "Locked while runtime is running" : "Runtime"}
                  >
                    <RuntimeIcon
                      name={
                        isSelectedRuntimeAvailable ? runtimeNameMap[props.runtimeId] : "Runtime"
                      }
                      size="xs"
                    />
                    <span>
                      {isSelectedRuntimeAvailable
                        ? runtimeNameMap[props.runtimeId]
                        : "Select runtime"}
                    </span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showRuntimePicker && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg border border-border-strong bg-surface py-1 shadow-xl">
                      {runtimeOptions.map((runtime) => (
                        <button
                          key={runtime.id}
                          onClick={() => {
                            props.onRuntimeIdChange!(runtime.id);
                            setShowRuntimePicker(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-surface-raised ${
                            runtime.id === props.runtimeId ? "text-fg" : "text-muted"
                          }`}
                        >
                          <RuntimeIcon name={runtime.name} size="xs" />
                          <span>{runtime.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              {runtimeHint ? <span className="text-[11px] text-warning">{runtimeHint}</span> : null}
              {props.onRuntimeModeChange ? (
                <div className="relative">
                  <button
                    onClick={() => {
                      if (!isThreadSending) {
                        setShowModePicker((v) => !v);
                      }
                    }}
                    disabled={isThreadSending}
                    className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-raised px-2.5 py-1 text-[11px] text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                    title={
                      isThreadSending ? "Locked while runtime is running" : "Runtime permissions"
                    }
                  >
                    <RuntimeModeIcon
                      mode={props.runtimeMode ?? DEFAULT_RUNTIME_MODE}
                      className="h-3 w-3"
                    />
                    <span>{getRuntimeModeLabel(props.runtimeMode ?? DEFAULT_RUNTIME_MODE)}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showModePicker && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg border border-border-strong bg-surface py-1 shadow-xl">
                      {(
                        ["approval-required", "auto-accept-edits", "full-access"] as RuntimeMode[]
                      ).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => {
                            props.onRuntimeModeChange!(mode);
                            setShowModePicker(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-surface-raised ${
                            mode === props.runtimeMode ? "text-fg" : "text-muted"
                          }`}
                        >
                          <RuntimeModeIcon mode={mode} className="h-3 w-3" />
                          <span>
                            {getRuntimeModeLabel(mode)}
                            {mode === "full-access" ? " (danger)" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {isThreadSending ? (
                <button
                  onClick={() => stop(threadId)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-danger text-white transition hover:opacity-90"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend || isThreadSending}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-90 disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
