import {
  ArrowUp,
  Bot,
  ChevronDown,
  FolderGit,
  GitBranch,
  Hand,
  Plus,
  Square,
} from "lucide-react";
import { useState, useRef } from "react";

import { useDraftThread } from "../../context/DraftThreadContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useChatRun } from "../../hooks/useChatRun";
import { agents } from "../../mock/uiShellData";
import type { Message } from "../../mock/uiShellData";

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

export function Composer(props: ComposerProps) {
  const { projects, appendMessage, updateMessage } = useWorkspace();
  const { appendDraftMessage, updateDraftMessage } = useDraftThread();
  const { isSending, send, stop } = useChatRun();
  const [input, setInput] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(
    agents.find((a) => a.selected)?.id ?? agents[0]?.id,
  );
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const accumulatedRef = useRef("");
  const project = projects.find((item) => item.id === props.projectId) ?? null;
  const threadId =
    props.mode === "draft" ? props.preallocatedThreadId : props.threadId;

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const canSend = !!input.trim() && !!project && !!selectedAgent;

  const handleSend = async () => {
    if (!canSend) return;

    const messageText = input.trim();
    const agentId = selectedAgent.id;
    setInput("");

    const appendLocalMessage = (
      role: "user" | "assistant",
      content: string,
    ) => {
      if (props.mode === "thread") {
        return {
          primary: appendMessage({
            threadId,
            role,
            agentId,
            content,
          }),
        };
      }

      const draftMessage = buildTextMessage(threadId, role, agentId, content);
      appendDraftMessage(props.draftId, draftMessage);

      return {
        primary: draftMessage,
        mirror: appendMessage({
          threadId,
          role,
          agentId,
          content,
        }),
      };
    };

    const updateLocalMessage = (
      messageIds: { primary: { id: string }; mirror?: { id: string } },
      content: string,
    ) => {
      if (props.mode === "thread") {
        updateMessage(messageIds.primary.id, content);
        return;
      }

      updateDraftMessage(props.draftId, messageIds.primary.id, content);

      if (messageIds.mirror) {
        updateMessage(messageIds.mirror.id, content);
      }
    };

    appendLocalMessage("user", messageText);
    const assistantMsg = appendLocalMessage("assistant", "");

    accumulatedRef.current = "";

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
          accumulatedRef.current += text;
          updateLocalMessage(assistantMsg, accumulatedRef.current);
        },
        onComplete: (text) => {
          updateLocalMessage(assistantMsg, text);
        },
        onError: (error) => {
          updateLocalMessage(assistantMsg, `Error: ${error}`);
        },
        onStop: () => {
          updateLocalMessage(
            assistantMsg,
            accumulatedRef.current + "\n\n[Stopped]",
          );
        },
      },
    );
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#333] bg-[#252525] p-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Message ${selectedAgent?.name ?? "Agent"}...`}
          className="w-full resize-none bg-transparent text-[14px] text-[#ddd] placeholder-[#666] outline-none"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend && !isSending) {
                handleSend();
              }
            }
          }}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#888] transition hover:bg-[#333] hover:text-[#ccc]">
              <Plus className="h-4 w-4" />
            </button>
            <button className="flex items-center gap-1 rounded-md bg-[#333] px-2 py-1 text-[12px] text-[#aaa] transition hover:bg-[#3a3a3a]">
              <Hand className="h-3 w-3" />
              <span>Default Access</span>
              <ChevronDown className="h-3 w-3 text-[#666]" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowAgentPicker((v) => !v)}
                className="flex items-center gap-1 rounded-md bg-[#333] px-2 py-1 text-[12px] text-[#aaa] transition hover:bg-[#3a3a3a]"
              >
                <Bot className="h-3 w-3" />
                <span>{selectedAgent?.name ?? "Agent"}</span>
                <ChevronDown className="h-3 w-3 text-[#666]" />
              </button>
              {showAgentPicker && (
                <div className="absolute bottom-full right-0 mb-1 w-40 rounded-md border border-[#333] bg-[#252525] py-1 shadow-lg">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => {
                        setSelectedAgentId(agent.id);
                        setShowAgentPicker(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-[#333] ${
                        agent.id === selectedAgentId
                          ? "text-[#eee]"
                          : "text-[#999]"
                      }`}
                    >
                      <Bot className="h-3 w-3" />
                      <span>{agent.name}</span>
                      <span className="ml-auto text-[10px] text-[#666]">
                        {agent.runtime}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isSending ? (
              <button
                onClick={stop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c44] text-white transition hover:bg-[#b33]"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4a6cf7] text-white transition hover:bg-[#3d5de4] disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="mx-auto mt-2 flex max-w-2xl items-center gap-4 px-1">
        <button className="flex items-center gap-1.5 text-[12px] text-[#666] transition hover:text-[#999]">
          <FolderGit className="h-3 w-3" />
          <span>{project?.name ?? "No project"}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
        <button className="flex items-center gap-1.5 text-[12px] text-[#666] transition hover:text-[#999]">
          <span>Local</span>
          <ChevronDown className="h-3 w-3" />
        </button>
        <button className="flex items-center gap-1 text-[12px] text-[#666] transition hover:text-[#999]">
          <GitBranch className="h-3 w-3" />
          <span>main</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
