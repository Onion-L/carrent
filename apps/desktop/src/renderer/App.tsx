import { Route, Routes } from "react-router-dom";

import { DesktopShell } from "./components/DesktopShell";
import { ToastProvider } from "./components/toast/ToastContext";
import { DraftThreadProvider } from "./context/DraftThreadContext";
import { AgentsPage } from "./routes/AgentsPage";
import { DraftThreadPage } from "./routes/DraftThreadPage";
import { HomePage } from "./routes/HomePage";
import { RuntimesPage } from "./routes/RuntimesPage";
import { SettingsPage } from "./routes/SettingsPage";
import { ThreadPage } from "./routes/ThreadPage";
import { WorkspaceProvider } from "./context/WorkspaceContext";

export default function App() {
  return (
    <WorkspaceProvider>
      <DraftThreadProvider>
        <ToastProvider>
          <DesktopShell>
            <Routes>
              <Route element={<HomePage />} path="/" />
              <Route element={<DraftThreadPage />} path="/draft/:draftId" />
              <Route element={<ThreadPage />} path="/thread/:projectId/:threadId" />
              <Route element={<AgentsPage />} path="/agents" />
              <Route element={<RuntimesPage />} path="/runtimes" />
              <Route element={<SettingsPage />} path="/settings" />
              <Route element={<HomePage />} path="*" />
            </Routes>
          </DesktopShell>
        </ToastProvider>
      </DraftThreadProvider>
    </WorkspaceProvider>
  );
}
