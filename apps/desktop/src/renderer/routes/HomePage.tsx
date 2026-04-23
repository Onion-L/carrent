import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { ThreadHistoryPane } from "../components/chat/ThreadHistoryPane";

export function HomePage() {
  return (
    <div className="flex h-full w-full">
      {/* Left: thread history */}
      <ThreadHistoryPane />

      {/* Right: chat workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader threadTitle="Project onboarding" />
        <MessageTimeline />
        <Composer />
      </div>
    </div>
  );
}
