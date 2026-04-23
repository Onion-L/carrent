import { User, Bot } from "lucide-react";
import { messages, agents } from "../../mock/uiShellData";
import { ChangedFilesCard } from "./ChangedFilesCard";

function AgentBadge({ agentId }: { agentId: string }) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;
  return (
    <span className="rounded bg-[#252525] px-1.5 py-0.5 text-[11px] text-[#888]">{agent.name}</span>
  );
}

function UserMessageBubble({ content, timestamp }: { content: string; timestamp: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[#2a2a2a] px-4 py-3">
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#eee]">{content}</p>
      </div>
      <span className="text-[11px] text-[#555]">{timestamp}</span>
    </div>
  );
}

function AssistantMessage({
  content,
  timestamp,
  duration,
  agentId,
}: {
  content?: string;
  timestamp: string;
  duration?: string;
  agentId: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2a2a2a] text-[#888]">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[#bbb]">Assistant</span>
          <AgentBadge agentId={agentId} />
        </div>
        {content && (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#ccc]">{content}</p>
        )}
        <span className="text-[11px] text-[#555]">
          {timestamp}
          {duration && ` · ${duration}`}
        </span>
      </div>
    </div>
  );
}

export function MessageTimeline() {
  return (
    <div className="flex flex-1 flex-col overflow-auto px-4 py-6">
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[15px] text-[#555]">Send a message to start the conversation.</p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <UserMessageBubble key={msg.id} content={msg.content} timestamp={msg.timestamp} />
              );
            }

            if (msg.type === "changed_files") {
              return (
                <div key={msg.id} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2a2a2a] text-[#888]">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[#bbb]">Assistant</span>
                      <AgentBadge agentId={msg.agentId} />
                    </div>
                    <ChangedFilesCard message={msg} />
                    <span className="text-[11px] text-[#555]">
                      {msg.timestamp}
                      {msg.duration && ` · ${msg.duration}`}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <AssistantMessage
                key={msg.id}
                content={msg.content}
                timestamp={msg.timestamp}
                duration={msg.duration}
                agentId={msg.agentId}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
