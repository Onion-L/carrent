import { Route, Routes } from "react-router-dom";

import { DesktopShell } from "./components/DesktopShell";
import { DraftThreadProvider } from "./context/DraftThreadContext";
import { AgentsPage } from "./routes/AgentsPage";
import { HomePage } from "./routes/HomePage";
import { RuntimesPage } from "./routes/RuntimesPage";
import { SettingsPage } from "./routes/SettingsPage";
import { WorkspaceProvider } from "./context/WorkspaceContext";

export default function App() {
  return (
    <WorkspaceProvider>
      <DraftThreadProvider>
        <DesktopShell>
          <Routes>
            <Route element={<HomePage />} path="/" />
            <Route element={<AgentsPage />} path="/agents" />
            <Route element={<RuntimesPage />} path="/runtimes" />
            <Route element={<SettingsPage />} path="/settings" />
            <Route element={<HomePage />} path="*" />
          </Routes>
        </DesktopShell>
      </DraftThreadProvider>
    </WorkspaceProvider>
  );
}
