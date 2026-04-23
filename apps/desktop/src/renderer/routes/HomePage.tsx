import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { messages } from "../mock/uiShellData";

export function HomePage() {
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader />
      {hasMessages ? (
        <MessageTimeline />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-4">
          <h2 className="text-center text-[28px] font-semibold text-[#ddd]">
            What should we build in carrent?
          </h2>
        </div>
      )}
      <Composer />
    </div>
  );
}
