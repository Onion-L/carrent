import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useWorkspace } from "../context/WorkspaceContext";

export function HomePage() {
  const { activeThreadId, currentThread, messages } = useWorkspace();
  const threadMessages = messages.filter((m) => m.threadId === activeThreadId);
  const hasMessages = threadMessages.length > 0;

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={currentThread?.title} />
      {hasMessages ? (
        <MessageTimeline messages={threadMessages} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-4">
          <h2 className="text-center text-[28px] font-semibold text-[#ddd]">
            {currentThread
              ? `What should we build in ${currentThread.title}?`
              : "Select a thread to start"}
          </h2>
        </div>
      )}
      <Composer />
    </div>
  );
}
