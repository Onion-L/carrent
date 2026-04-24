import { Route, Routes } from "react-router-dom";

import { DesktopShell } from "./components/DesktopShell";
import { AgentsPage } from "./routes/AgentsPage";
import { HomePage } from "./routes/HomePage";
import { RuntimesPage } from "./routes/RuntimesPage";
import { SettingsPage } from "./routes/SettingsPage";
import { ActiveThreadProvider } from "./context/ActiveThreadContext";
import { projects } from "./mock/uiShellData";

const initialThreadId =
  projects
    .flatMap((p) => p.threads)
    .find((t) => t.active)?.id ?? null;

export default function App() {
  return (
    <ActiveThreadProvider initialThreadId={initialThreadId}>
      <DesktopShell>
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<AgentsPage />} path="/agents" />
          <Route element={<RuntimesPage />} path="/runtimes" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<HomePage />} path="*" />
        </Routes>
      </DesktopShell>
    </ActiveThreadProvider>
  );
}
