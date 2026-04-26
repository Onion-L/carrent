import { ArrowUp, Bot, ChevronDown, Hand, Plus, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useDraftThread } from "../../context/DraftThreadContext";
import {
  TYPEWRITER_INTERVAL_MS,
  getNextTypewriterText,
  hasPendingTypewriterText,
} from "./typewriter";
import { useAgents } from "../../context/AgentContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useChatRun } from "../../hooks/useChatRun";
import type { Message } from "../../mock/uiShellData";
import type { ChatShellEventPayload } from "../../../shared/chat";

type ComposerProps =
  | {
      mode: "draft";
      draftId: string;
      projectId: string;
      title: string;
      preallocatedThreadId: string;
      messages: Message[];
    }
  | {
      mode: "thread";
      projectId: string;
      threadId: string;
      messages: Message[];
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

function buildTextMessage(
  threadId: string,
  role: "user" | "assistant",
  agentId: string,
  content: string,
): Message {
  return {
    id: createMessageId(),
    role,
    agentId,
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
  const { projects, appendMessage, updateMessage, updateMessageParts } = useWorkspace();
  const { appendDraftMessage, updateDraftMessage, updateDraftMessageParts } = useDraftThread();
  const { isSending, send, stop } = useChatRun();
  const { agents, selectedAgentId, selectedAgent, setSelectedAgentId } = useAgents();
  const [input, setInput] = useState("");
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const receivedTextRef = useRef("");
  const visibleTextRef = useRef("");
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const flushTypewriterRef = useRef<VoidFunction | null>(null);
  const project = projects.find((item) => item.id === props.projectId) ?? null;
  const threadId = props.mode === "draft" ? props.preallocatedThreadId : props.threadId;

  const canSend = !!input.trim() && !!project && !!selectedAgent;

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

  const handleSend = async () => {
    if (!canSend || !selectedAgent) return;

    const messageText = input.trim();
    const agentId = selectedAgent.id;
    setInput("");

    const appendLocalMessage = (role: "user" | "assistant", content: string) => {
      if (props.mode === "thread") {
        return appendMessage({
          threadId,
          role,
          agentId,
          content,
        });
      }

      const draftMessage = buildTextMessage(threadId, role, agentId, content);
      appendDraftMessage(props.draftId, draftMessage);
      return draftMessage;
    };

    const updateLocalMessage = (messageId: string, content: string) => {
      if (props.mode === "thread") {
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

      if (props.mode === "thread") {
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
      if (props.mode === "thread") {
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
        agentId: m.agentId,
      }));

    await send(
      {
        projectPath: project.path,
        threadId,
        draftRef:
          props.mode === "draft"
            ? {
                draftId: props.draftId,
                projectId: props.projectId,
                title: props.title,
              }
            : undefined,
        runtimeId: selectedAgent.runtime,
        agent: {
          id: agentId,
          name: selectedAgent.name,
          responsibility: selectedAgent.responsibility,
        },
        transcript,
        message: messageText,
      },
      {
        onDelta: (text) => {
          receivedTextRef.current += text;
          startTypewriter(assistantMsg.id);
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
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1e1e1e] p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedAgent ? `Message ${selectedAgent.name}...` : "Select an agent..."}
            className="w-full resize-none bg-transparent text-[14px] text-[#ddd] placeholder-[#555] outline-none"
            rows={2}
            onKeyDown={(e) => {
              if (shouldSubmitComposerOnKeyDown(e)) {
                e.preventDefault();
                if (canSend && !isSending) {
                  handleSend();
                }
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button className="flex h-6 w-6 items-center justify-center rounded text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]">
                <Hand className="h-3 w-3" />
                <span>Default</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setShowAgentPicker((v) => !v)}
                  className="flex items-center gap-1.5 rounded-full border border-[#333] bg-[#252525] px-2.5 py-1 text-[11px] text-[#aaa] transition hover:border-[#444] hover:bg-[#2a2a2a]"
                >
                  <Bot className="h-3 w-3" />
                  <span>{selectedAgent?.name ?? "Agent"}</span>
                  <ChevronDown className="h-3 w-3 text-[#666]" />
                </button>
                {showAgentPicker && (
                  <div className="absolute bottom-full right-0 mb-1.5 w-40 rounded-lg border border-[#333] bg-[#1e1e1e] py-1 shadow-xl">
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => {
                          setSelectedAgentId(agent.id);
                          setShowAgentPicker(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-[#252525] ${
                          agent.id === selectedAgentId ? "text-[#eee]" : "text-[#999]"
                        }`}
                      >
                        <Bot className="h-3 w-3" />
                        <span>{agent.name}</span>
                        <span className="ml-auto text-[10px] text-[#666]">{agent.runtime}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {isSending ? (
                <button
                  onClick={stop}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[#c44] text-white transition hover:bg-[#b33]"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[#4a6cf7] text-white transition hover:bg-[#3d5de4] disabled:opacity-30"
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
