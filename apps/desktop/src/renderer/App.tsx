import { Navigate, Route, Routes } from "react-router-dom";

import { DesktopShell } from "./components/DesktopShell";
import { ToastProvider } from "./components/toast/ToastContext";
import { useWorkspace } from "./context/WorkspaceContext";
import { SettingsProvider } from "./context/SettingsContext";
import { RuntimeModelsProvider } from "./context/RuntimeModelsContext";
import { HomePage } from "./routes/HomePage";
import { SettingsPage } from "./routes/SettingsPage";
import { ThreadPage } from "./routes/ThreadPage";
import { ChatPage } from "./routes/ChatPage";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { AppStateProvider, useAppState } from "./context/AppStateContext";
import { FirstUsePage } from "./routes/FirstUsePage";
import { WorkspaceOverviewPage } from "./routes/WorkspaceOverviewPage";
import { ProjectOverviewPage } from "./routes/ProjectOverviewPage";

function WorkspaceRestoreRoute() {
  const { workspaces, activeWorkspaceId } = useAppState();
  const target =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null;
  return target ? <Navigate replace to={`/workspace/${target.id}`} /> : <FirstUsePage />;
}

function AppRoutes() {
  const { hasHydrated: hasLegacyHydrated } = useWorkspace();
  const { hasHydrated, workspaces } = useAppState();

  if (!hasHydrated || !hasLegacyHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <span className="text-app-14 text-subtle">Loading App State...</span>
      </div>
    );
  }

  if (workspaces.length === 0) return <FirstUsePage />;

  return (
    <ToastProvider>
      <DesktopShell>
        <Routes>
          <Route element={<WorkspaceRestoreRoute />} path="/" />
          <Route element={<WorkspaceOverviewPage />} path="/workspace/:workspaceId" />
          <Route
            element={<ProjectOverviewPage />}
            path="/workspace/:workspaceId/project/:projectId"
          />
          <Route element={<HomePage />} path="/project/:projectId" />
          <Route element={<ThreadPage />} path="/thread/:projectId/:threadId" />
          <Route element={<ChatPage />} path="/chat/:threadId" />
          <Route element={<HomePage />} path="/agents" />
          <Route element={<Navigate replace to="/settings?tab=runtime" />} path="/runtimes" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<HomePage />} path="*" />
        </Routes>
      </DesktopShell>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <WorkspaceProvider>
        <SettingsProvider>
          <RuntimeModelsProvider>
            <AppRoutes />
          </RuntimeModelsProvider>
        </SettingsProvider>
      </WorkspaceProvider>
    </AppStateProvider>
  );
}
