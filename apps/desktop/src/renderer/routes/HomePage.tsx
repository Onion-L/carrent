import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useActiveThread } from "../context/ActiveThreadContext";
import { projects, messages } from "../mock/uiShellData";

export function HomePage() {
  const { activeThreadId } = useActiveThread();

  const allThreads = projects.flatMap((p) => p.threads);
  const currentThread = allThreads.find((t) => t.id === activeThreadId);
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
