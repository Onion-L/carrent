import { AlertTriangle, ArrowUp, Check, ChevronDown, Lock, Pencil, Square } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
import { useRuntimeModels } from "../../hooks/useRuntimeModels";
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
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModelIdChange?: (modelId: string | undefined) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
    }
  | {
      mode: "thread";
      projectId: string;
      threadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModelIdChange?: (modelId: string | undefined) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
    }
  | {
      mode: "chat";
      threadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModelIdChange?: (modelId: string | undefined) => void;
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

type ViewportSize = {
  width: number;
  height: number;
};

type RectLike = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

type CascadingPanelSide = "right" | "left" | "center";

export type CascadingPanelPosition = {
  left: number;
  top: number;
  width: number;
  side: CascadingPanelSide;
};

const CASCADING_PANEL_GAP = 8;
const CASCADING_PANEL_PADDING = 8;
const CASCADING_PANEL_MIN_WIDTH = 180;
const CASCADING_PANEL_DEFAULT_WIDTH = 288;

export function shouldSubmitComposerOnKeyDown(event: ComposerKeyDownEvent) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  );
}

export function getCascadingPanelPosition(
  anchorRect: RectLike,
  viewport: ViewportSize,
  panelSize: { width: number; height: number },
  gap = CASCADING_PANEL_GAP,
  padding = CASCADING_PANEL_PADDING,
): CascadingPanelPosition {
  const maxViewportWidth = Math.max(0, viewport.width - padding * 2);
  const desiredWidth = Math.min(
    Math.max(panelSize.width || CASCADING_PANEL_DEFAULT_WIDTH, CASCADING_PANEL_MIN_WIDTH),
    maxViewportWidth,
  );
  const rightSpace = viewport.width - padding - (anchorRect.right + gap);
  const leftSpace = anchorRect.left - gap - padding;
  const maxViewportHeight = Math.max(0, viewport.height - padding * 2);
  const desiredHeight = Math.min(panelSize.height || 0, maxViewportHeight || panelSize.height || 0);

  const useCenterFallback = Math.max(rightSpace, leftSpace) < CASCADING_PANEL_MIN_WIDTH;

  let side: CascadingPanelSide;
  let width: number;
  let left: number;

  if (!useCenterFallback && (rightSpace >= desiredWidth || rightSpace >= leftSpace)) {
    side = "right";
    width = Math.min(desiredWidth, Math.max(0, rightSpace));
    left = anchorRect.right + gap;
  } else if (!useCenterFallback) {
    side = "left";
    width = Math.min(desiredWidth, Math.max(0, leftSpace));
    left = anchorRect.left - gap - width;
  } else {
    side = "center";
    width = desiredWidth;
    left = (viewport.width - width) / 2;
  }

  const safeLeft = Math.min(
    Math.max(left, padding),
    Math.max(padding, viewport.width - padding - width),
  );
  const safeTop = Math.min(
    Math.max(anchorRect.top, padding),
    Math.max(padding, viewport.height - padding - desiredHeight),
  );

  return {
    left: safeLeft,
    top: safeTop,
    width,
    side,
  };
}

export function Composer(props: ComposerProps) {
  const { projects, chats, appendMessage, updateMessage, updateMessageParts, upsertChat } =
    useWorkspace();
  const { appendDraftMessage, updateDraftMessage, updateDraftMessageParts } = useDraftThread();
  const { runningThreadIds, send, stop } = useChatRun();
  const { runtimes, loading: runtimesLoading } = useRuntimes();
  const [input, setInput] = useState("");
  const [showRuntimePicker, setShowRuntimePicker] = useState(false);
  const [cascadingRuntimeId, setCascadingRuntimeId] = useState<RuntimeId | null>(null);
  const [isPointerOverRuntimeMenu, setIsPointerOverRuntimeMenu] = useState(false);
  const [isPointerOverCascadingPanel, setIsPointerOverCascadingPanel] = useState(false);
  const [cascadingAnchorRect, setCascadingAnchorRect] = useState<RectLike | null>(null);
  const [cascadingPanelPosition, setCascadingPanelPosition] =
    useState<CascadingPanelPosition | null>(null);
  const [showModePicker, setShowModePicker] = useState(false);
  const runtimePickerRef = useRef<HTMLDivElement>(null);
  const cascadingPanelRef = useRef<HTMLDivElement>(null);
  const modePickerRef = useRef<HTMLDivElement>(null);
  const runtimeCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const modelRuntimeId = props.runtimeId;
  const { models, defaultModelId } = useRuntimeModels(modelRuntimeId);
  const { models: cascadingModels, loading: cascadingLoading } = useRuntimeModels(
    cascadingRuntimeId,
  );
  const effectiveRuntimeModelId = props.runtimeModelId ?? defaultModelId;
  const selectedRuntimeModel = models.find((model) => model.id === effectiveRuntimeModelId);
  const isSelectedRuntimeAvailable = isChatRuntimeAvailable(props.runtimeId, runtimes);
  const runtimeButtonLabel = runtimesLoading
    ? "Checking runtimes"
    : runtimeOptions.length === 0
      ? "No runtime available"
      : isSelectedRuntimeAvailable
        ? selectedRuntimeModel
          ? `${runtimeNameMap[props.runtimeId]} · ${selectedRuntimeModel.name}`
          : runtimeNameMap[props.runtimeId]
        : "Select runtime";

  const canSend =
    (props.mode === "chat" ? !!input.trim() : !!input.trim() && !!project) &&
    isSelectedRuntimeAvailable;
  const isThreadSending = runningThreadIds.includes(threadId);
  const showCascadingPanel =
    showRuntimePicker && cascadingRuntimeId === "pi" && !!props.onRuntimeModelIdChange;
  const cascadingPanelTransitionClass = !cascadingPanelPosition
    ? "pointer-events-none opacity-0 translate-y-1 scale-95"
    : "opacity-100 translate-x-0 translate-y-0 scale-100";

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

  const closeRuntimePicker = () => {
    if (runtimeCloseTimerRef.current) {
      clearTimeout(runtimeCloseTimerRef.current);
      runtimeCloseTimerRef.current = null;
    }
    setShowRuntimePicker(false);
    setCascadingRuntimeId(null);
    setCascadingAnchorRect(null);
    setCascadingPanelPosition(null);
    setIsPointerOverRuntimeMenu(false);
    setIsPointerOverCascadingPanel(false);
  };

  const scheduleRuntimePickerClose = () => {
    if (runtimeCloseTimerRef.current) {
      clearTimeout(runtimeCloseTimerRef.current);
    }

    runtimeCloseTimerRef.current = setTimeout(() => {
      runtimeCloseTimerRef.current = null;
      closeRuntimePicker();
    }, 120);
  };

  useEffect(() => {
    return () => {
      flushActiveTypewriter();
      if (runtimeCloseTimerRef.current) {
        clearTimeout(runtimeCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showRuntimePicker && !showModePicker) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        showRuntimePicker &&
        runtimePickerRef.current &&
        !runtimePickerRef.current.contains(target) &&
        !(cascadingPanelRef.current && cascadingPanelRef.current.contains(target))
      ) {
        closeRuntimePicker();
      }
      if (
        showModePicker &&
        modePickerRef.current &&
        !modePickerRef.current.contains(target)
      ) {
        setShowModePicker(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showRuntimePicker) {
          closeRuntimePicker();
        }
        if (showModePicker) {
          setShowModePicker(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showRuntimePicker, showModePicker]);

  useEffect(() => {
    if (!showRuntimePicker || !cascadingRuntimeId) {
      return;
    }

    if (isPointerOverRuntimeMenu || isPointerOverCascadingPanel) {
      if (runtimeCloseTimerRef.current) {
        clearTimeout(runtimeCloseTimerRef.current);
        runtimeCloseTimerRef.current = null;
      }
      return;
    }

    scheduleRuntimePickerClose();
  }, [
    cascadingRuntimeId,
    isPointerOverCascadingPanel,
    isPointerOverRuntimeMenu,
    showRuntimePicker,
  ]);

  const updateCascadingPanelPosition = useCallback(() => {
    if (!showRuntimePicker || !cascadingRuntimeId || !cascadingAnchorRect) {
      return;
    }

    const panelElement = cascadingPanelRef.current;
    if (!panelElement) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    if (panelRect.width <= 0 || panelRect.height <= 0) {
      return;
    }

    setCascadingPanelPosition(
      getCascadingPanelPosition(
        cascadingAnchorRect,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        {
          width: panelRect.width,
          height: panelRect.height,
        },
      ),
    );
  }, [cascadingAnchorRect, cascadingRuntimeId, showRuntimePicker]);

  useLayoutEffect(() => {
    if (!showRuntimePicker || !cascadingRuntimeId || !cascadingAnchorRect) {
      return;
    }

    updateCascadingPanelPosition();
  }, [
    cascadingAnchorRect,
    cascadingRuntimeId,
    cascadingLoading,
    cascadingModels.length,
    effectiveRuntimeModelId,
    showRuntimePicker,
    updateCascadingPanelPosition,
  ]);

  useEffect(() => {
    if (!showRuntimePicker || !cascadingRuntimeId || !cascadingAnchorRect) {
      return;
    }

    const handleWindowUpdate = () => {
      updateCascadingPanelPosition();
    };

    window.addEventListener("resize", handleWindowUpdate);
    window.addEventListener("scroll", handleWindowUpdate, true);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            handleWindowUpdate();
          });

    if (observer && cascadingPanelRef.current) {
      observer.observe(cascadingPanelRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleWindowUpdate);
      window.removeEventListener("scroll", handleWindowUpdate, true);
      observer?.disconnect();
    };
  }, [cascadingAnchorRect, cascadingRuntimeId, showRuntimePicker, updateCascadingPanelPosition]);

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
        runtimeModelId: effectiveRuntimeModelId,
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
                <div ref={runtimePickerRef} className="relative">
                  <button
                    onClick={() => {
                      if (!isThreadSending) {
                        setShowRuntimePicker((v) => {
                          if (v) {
                            closeRuntimePicker();
                          } else {
                            setIsPointerOverRuntimeMenu(true);
                          }
                          return !v;
                        });
                      }
                    }}
                    disabled={isThreadSending}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
                      showRuntimePicker
                        ? "border-fg/20 bg-surface-hover text-fg"
                        : "border-border-strong bg-surface-raised text-muted hover:bg-surface-hover hover:text-fg"
                    }`}
                    title={isThreadSending ? "Locked while runtime is running" : "Runtime"}
                  >
                    <RuntimeIcon
                      name={
                        isSelectedRuntimeAvailable ? runtimeNameMap[props.runtimeId] : "Runtime"
                      }
                      size="xs"
                    />
                    <span>{runtimeButtonLabel}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showRuntimePicker && (
                    <div
                      className="absolute bottom-full left-0 mb-1.5 max-h-80 w-64 overflow-y-auto rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
                      onMouseEnter={() => setIsPointerOverRuntimeMenu(true)}
                      onMouseLeave={() => {
                        setIsPointerOverRuntimeMenu(false);
                      }}
                    >
                      {runtimeOptions.length > 0 ? (
                        runtimeOptions.map((runtime) => {
                          const supportsModelCascade =
                            runtime.id === "pi" && props.onRuntimeModelIdChange;

                          return (
                            <button
                              key={runtime.id}
                              onMouseEnter={(event) => {
                                if (!supportsModelCascade) {
                                  setCascadingRuntimeId(null);
                                  setCascadingAnchorRect(null);
                                  setCascadingPanelPosition(null);
                                  return;
                                }

                                const rect = event.currentTarget.getBoundingClientRect();
                                setCascadingRuntimeId(runtime.id);
                                setCascadingAnchorRect({
                                  left: rect.left,
                                  top: rect.top,
                                  right: rect.right,
                                  bottom: rect.bottom,
                                  width: rect.width,
                                  height: rect.height,
                                });
                                setIsPointerOverCascadingPanel(false);
                              }}
                              onClick={() => {
                                props.onRuntimeIdChange!(runtime.id);
                                if (runtime.id !== "pi" || !props.onRuntimeModelIdChange) {
                                  props.onRuntimeModelIdChange?.(undefined);
                                  closeRuntimePicker();
                                  return;
                                }

                                if (cascadingRuntimeId !== "pi") {
                                  closeRuntimePicker();
                                  return;
                                }

                                closeRuntimePicker();
                              }}
                              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-surface-raised ${
                                runtime.id === props.runtimeId ? "text-fg" : "text-muted"
                              }`}
                            >
                              <RuntimeIcon name={runtime.name} size="xs" />
                              <span className="min-w-0 flex-1">{runtime.name}</span>
                              {supportsModelCascade ? (
                                <ChevronDown className="ml-auto h-3 w-3 shrink-0" />
                              ) : null}
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-2 text-[12px] leading-5 text-subtle">
                          No runtime available
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
              {showCascadingPanel && typeof document !== "undefined"
                ? createPortal(
                    <div
                      ref={cascadingPanelRef}
                      onMouseEnter={() => {
                        setIsPointerOverCascadingPanel(true);
                        if (runtimeCloseTimerRef.current) {
                          clearTimeout(runtimeCloseTimerRef.current);
                          runtimeCloseTimerRef.current = null;
                        }
                      }}
                      onMouseLeave={() => {
                        setIsPointerOverCascadingPanel(false);
                      }}
                      className={`fixed z-50 rounded-lg border border-border-strong bg-surface py-1 shadow-xl transition-[opacity,transform] duration-150 ease-out ${cascadingPanelTransitionClass}`}
                      style={{
                        left: `${cascadingPanelPosition?.left ?? 0}px`,
                        top: `${cascadingPanelPosition?.top ?? 0}px`,
                        width: `${cascadingPanelPosition?.width ?? CASCADING_PANEL_DEFAULT_WIDTH}px`,
                        maxHeight: `calc(100vh - ${CASCADING_PANEL_PADDING * 2}px)`,
                        visibility: cascadingPanelPosition ? "visible" : "hidden",
                        transformOrigin:
                          cascadingPanelPosition?.side === "left"
                            ? "top right"
                            : cascadingPanelPosition?.side === "right"
                              ? "top left"
                              : "top center",
                      }}
                    >
                      <div className="px-3 pb-1.5 pt-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          pi models
                        </div>
                      </div>
                      <div className="max-h-[calc(100vh-24px)] overflow-y-auto px-1 pb-1">
                        {props.runtimeModelId &&
                        !cascadingModels.some((model) => model.id === props.runtimeModelId) ? (
                          <button
                            onClick={() => {
                              props.onRuntimeIdChange?.("pi");
                              props.onRuntimeModelIdChange?.(props.runtimeModelId);
                              closeRuntimePicker();
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-[12px] text-fg transition hover:bg-surface-raised"
                          >
                            <span className="min-w-0 truncate">{props.runtimeModelId}</span>
                            <Check className="h-3.5 w-3.5 shrink-0 text-fg" />
                          </button>
                        ) : null}

                        {cascadingLoading ? (
                          <div className="px-3 py-2 text-[12px] leading-5 text-subtle">
                            Loading models...
                          </div>
                        ) : cascadingModels.length > 0 ? (
                          cascadingModels.map((model) => {
                            const label = model.provider
                              ? `${model.provider} / ${model.name}`
                              : model.name;
                            const isSelected = model.id === props.runtimeModelId;

                            return (
                              <button
                                key={model.id}
                                onClick={() => {
                                  props.onRuntimeIdChange?.("pi");
                                  props.onRuntimeModelIdChange?.(model.id);
                                  closeRuntimePicker();
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-[12px] transition hover:bg-surface-raised ${
                                  isSelected ? "text-fg" : "text-muted"
                                }`}
                              >
                                <span className="min-w-0 truncate">{label}</span>
                                {isSelected ? (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-fg" />
                                ) : null}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-3 py-2 text-[12px] leading-5 text-subtle">
                            No models found.
                          </div>
                        )}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
              {props.onRuntimeModeChange ? (
                <div ref={modePickerRef} className="relative">
                  <button
                    onClick={() => {
                      if (!isThreadSending) {
                        setShowModePicker((v) => !v);
                      }
                    }}
                    disabled={isThreadSending}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
                      showModePicker
                        ? "border-fg/20 bg-surface-hover text-fg"
                        : "border-border-strong bg-surface-raised text-muted hover:bg-surface-hover hover:text-fg"
                    }`}
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
