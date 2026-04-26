import { Bot } from "lucide-react";
import { agents, type Message } from "../../mock/uiShellData";
import { ChangedFilesCard } from "./ChangedFilesCard";

function AgentLabel({ agentId }: { agentId: string }) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;
  return (
    <span className="text-[12px] font-medium text-[#666]">{agent.name}</span>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#2a2a2a] px-4 py-3">
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#eee]">
          {content}
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  timestamp,
  agentId,
}: {
  content?: string;
  timestamp: string;
  agentId: string;
}) {
  const isStreaming = content === "";

  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#252525] text-[#666]">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <AgentLabel agentId={agentId} />
          <span className="text-[11px] text-[#444]">{timestamp}</span>
        </div>
        {isStreaming ? (
          <div className="flex items-center py-1">
            {"Thinking".split("").map((char, i) => (
              <span
                key={i}
                className="inline-block animate-pulse text-[13px] text-[#666]"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                {char}
              </span>
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#ccc]">
            {content}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252525]">
        <Bot className="h-5 w-5 text-[#555]" />
      </div>
      <p className="text-[15px] text-[#555]">What should we build?</p>
    </div>
  );
}

export function MessageTimeline({ messages }: { messages: Message[] }) {
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {messages.map((msg, idx) => {
            const isLast = idx === messages.length - 1;

            if (msg.role === "user") {
              return (
                <div
                  key={msg.id}
                  className={`px-4 py-5 ${!isLast ? "border-b border-[#222]" : ""}`}
                >
                  <UserMessage content={msg.content} />
                </div>
              );
            }

            if (msg.type === "changed_files") {
              return (
                <div
                  key={msg.id}
                  className={`px-4 py-5 ${!isLast ? "border-b border-[#222]" : ""}`}
                >
                  <div className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#252525] text-[#666]">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <AgentLabel agentId={msg.agentId} />
                        <span className="text-[11px] text-[#444]">
                          {msg.timestamp}
                        </span>
                      </div>
                      <ChangedFilesCard message={msg} />
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`px-4 py-5 ${!isLast ? "border-b border-[#222]" : ""}`}
              >
                <AssistantMessage
                  content={msg.content}
                  timestamp={msg.timestamp}
                  agentId={msg.agentId}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
