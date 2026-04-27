import { Route, Routes } from "react-router-dom";

import { DesktopShell } from "./components/DesktopShell";
import { ToastProvider } from "./components/toast/ToastContext";
import { AgentProvider } from "./context/AgentContext";
import { DraftThreadProvider } from "./context/DraftThreadContext";
import { useWorkspace } from "./context/WorkspaceContext";
import { SettingsProvider } from "./context/SettingsContext";
import { AgentsPage } from "./routes/AgentsPage";
import { DraftThreadPage } from "./routes/DraftThreadPage";
import { HomePage } from "./routes/HomePage";
import { RuntimesPage } from "./routes/RuntimesPage";
import { SettingsPage } from "./routes/SettingsPage";
import { ThreadPage } from "./routes/ThreadPage";
import { ChatPage } from "./routes/ChatPage";
import { WorkspaceProvider } from "./context/WorkspaceContext";

function AppRoutes() {
  const { hasHydrated } = useWorkspace();

  if (!hasHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#181818]">
        <span className="text-[14px] text-[#555]">Loading workspace...</span>
      </div>
    );
  }

  return (
    <AgentProvider>
      <DraftThreadProvider>
        <ToastProvider>
          <DesktopShell>
            <Routes>
              <Route element={<HomePage />} path="/" />
              <Route element={<DraftThreadPage />} path="/draft/:draftId" />
              <Route element={<ThreadPage />} path="/thread/:projectId/:threadId" />
              <Route element={<ChatPage />} path="/chat/:threadId" />
              <Route element={<AgentsPage />} path="/agents" />
              <Route element={<RuntimesPage />} path="/runtimes" />
              <Route element={<SettingsPage />} path="/settings" />
              <Route element={<HomePage />} path="*" />
            </Routes>
          </DesktopShell>
        </ToastProvider>
      </DraftThreadProvider>
    </AgentProvider>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <SettingsProvider>
        <AppRoutes />
      </SettingsProvider>
    </WorkspaceProvider>
  );
}
