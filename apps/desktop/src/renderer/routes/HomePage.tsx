import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";

export function HomePage() {
  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader />
      <MessageTimeline />
      <Composer />
    </div>
  );
}
