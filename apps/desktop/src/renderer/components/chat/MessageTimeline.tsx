import { User, Bot } from "lucide-react";
import { messages, agents } from "../../mock/uiShellData";

function AgentBadge({ agentId }: { agentId: string }) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;
  return (
    <span className="rounded bg-[#252525] px-1.5 py-0.5 text-[11px] text-[#888]">
      {agent.name}
    </span>
  );
}

export function MessageTimeline() {
  return (
    <div className="flex flex-1 flex-col overflow-auto px-4 py-6">
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[15px] text-[#555]">
            Send a message to start the conversation.
          </p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div key={msg.id} className="flex gap-3">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    isUser ? "bg-[#333] text-[#ccc]" : "bg-[#2a2a2a] text-[#888]"
                  }`}
                >
                  {isUser ? (
                    <User className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[#bbb]">
                      {isUser ? "You" : "Assistant"}
                    </span>
                    {!isUser && <AgentBadge agentId={msg.agentId} />}
                  </div>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#ccc]">
                    {msg.content}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
