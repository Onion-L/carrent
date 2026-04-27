import { ArrowDown, Bot, Check, Copy, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAgents } from "../../context/AgentContext";
import { type Message } from "../../mock/uiShellData";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { ShellBlock } from "./ShellBlock";

function AgentLabel({ agentId }: { agentId: string }) {
  const { agents } = useAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return <span className="text-[12px] font-medium text-subtle">Unknown agent</span>;
  return <span className="text-[12px] font-medium text-subtle">{agent.name}</span>;
}

function UserMessage({ content, timestamp }: { content: string; timestamp: string }) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="relative flex justify-end"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-user-bubble px-4 py-3">
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-user-bubble-fg">
          {content}
        </p>
      </div>
      {hovered && (
        <div className="absolute -bottom-6 right-0 flex items-center gap-3 px-1">
          <span className="text-[12px] text-subtle">{timestamp}</span>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Retry"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={handleCopy}
            className="flex h-6 w-6 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Copy"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  timestamp,
  agentId,
}: {
  message: Message;
  timestamp: string;
  agentId: string;
}) {
  const content = message.content ?? "";
  const parts = message.type !== "changed_files" ? message.parts : undefined;
  const hasParts = !!parts?.length;
  const isStreaming = !hasParts && content === "";

  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-raised text-subtle">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <AgentLabel agentId={agentId} />
          <span className="text-[11px] text-subtle">{timestamp}</span>
        </div>
        {isStreaming ? (
          <div className="flex items-center py-1">
            {"Thinking".split("").map((char, i) => (
              <span
                key={i}
                className="inline-block animate-pulse text-[13px] text-subtle"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                {char}
              </span>
            ))}
          </div>
        ) : hasParts ? (
          <div className="flex flex-col gap-3">
            {parts?.map((part, index) =>
              part.type === "text" ? (
                part.content ? (
                  <p
                    key={`${index}-text`}
                    className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg"
                  >
                    {part.content}
                  </p>
                ) : null
              ) : part.type === "reasoning" ? (
                <ReasoningBlock key={part.id} reasoning={part} />
              ) : (
                <ShellBlock key={part.id} shell={part} />
              ),
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-fg">{content}</p>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-raised">
        <Bot className="h-5 w-5 text-subtle" />
      </div>
      <p className="text-[15px] text-subtle">What should we build?</p>
    </div>
  );
}

export function MessageTimeline({ messages }: { messages: Message[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const threshold = 80;
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollButton(distanceToBottom > threshold);
    };

    el.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < threshold) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col">
            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="px-4 py-5">
                    <UserMessage content={msg.content} timestamp={msg.timestamp} />
                  </div>
                );
              }

              if (msg.type === "changed_files") {
                return (
                  <div key={msg.id} className="px-4 py-5">
                    <div className="flex gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-raised text-subtle">
                        <Bot className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <AgentLabel agentId={msg.agentId} />
                          <span className="text-[11px] text-subtle">{msg.timestamp}</span>
                        </div>
                        <ChangedFilesCard message={msg} />
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="px-4 py-5">
                  <AssistantMessage message={msg} timestamp={msg.timestamp} agentId={msg.agentId} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-muted shadow-lg transition hover:border-border-strong hover:bg-surface-hover hover:text-fg"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
