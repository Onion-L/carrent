import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { DesktopShell } from "./components/DesktopShell";
import { ToastProvider } from "./components/toast/ToastContext";
import { useThreadContent } from "./context/ThreadContentContext";
import { SettingsProvider } from "./context/SettingsContext";
import { RuntimeModelsProvider } from "./context/RuntimeModelsContext";
import { SettingsPage } from "./routes/SettingsPage";
import { ThreadPage } from "./routes/ThreadPage";
import { ThreadContentProvider } from "./context/ThreadContentContext";
import { AppStateProvider, useAppState } from "./context/AppStateContext";
import { FirstUsePage } from "./routes/FirstUsePage";
import { WorkspaceOverviewPage } from "./routes/WorkspaceOverviewPage";
import { ProjectOverviewPage } from "./routes/ProjectOverviewPage";
import { AppStateRecoveryPage } from "./routes/AppStateRecoveryPage";
import { useToast } from "./components/toast/ToastContext";
import { getWorkspaceRestorePath, resolveThreeLevelRoute } from "./lib/navigation";
import { useChatRun } from "./hooks/useChatRun";

const LEGACY_ROUTE_PATTERN = /^\/(?:project\/[^/]+|thread\/[^/]+\/[^/]+|chat\/[^/]+)$/u;

function AppStateNotice() {
  const { recoveryNotice, clearRecoveryNotice } = useAppState();
  const { showToast } = useToast();

  useEffect(() => {
    if (!recoveryNotice) return;
    showToast(
      recoveryNotice === "legacy-reset"
        ? "Old development data was reset."
        : "Carrent data was reset.",
      "info",
    );
    clearRecoveryNotice();
  }, [clearRecoveryNotice, recoveryNotice, showToast]);

  return null;
}

function MainWindowNavigation() {
  const navigate = useNavigate();

  useEffect(() => window.carrent.mainWindow.onNavigate((path) => navigate(path)), [navigate]);

  return null;
}

function NavigationCoordinator() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    workspaces,
    projects,
    associations,
    threads,
    rememberThreadLocation,
    archiveNavigation,
    setArchiveNavigation,
  } = useAppState();
  const notifiedLocations = useRef(new Set<string>());

  useEffect(() => {
    let target: string | null = null;
    let notice: string | null = null;

    if (LEGACY_ROUTE_PATTERN.test(location.pathname)) {
      target = "/";
      notice = "This link is incompatible with the current navigation model.";
    } else {
      const resolution = resolveThreeLevelRoute(
        { workspaces, projects, associations, threads },
        location.pathname,
      );
      if (archiveNavigation && location.pathname !== archiveNavigation.sourcePath) {
        // The archive transition navigated away (or the user beat it to the
        // destination); hand route control back.
        setArchiveNavigation(null);
      }
      if (resolution.kind === "fallback") {
        if (archiveNavigation && location.pathname === archiveNavigation.sourcePath) {
          // Archiving the open Thread briefly leaves this route stale; the archive
          // transition performs its own navigation to the chosen destination.
          return;
        }
        target = resolution.to;
        notice = resolution.notice;
      } else if (resolution.kind === "thread") {
        void rememberThreadLocation(resolution.workspaceId, resolution.threadId).catch((error) => {
          console.error("[app-state] failed to remember Thread location", error);
        });
      }
    }

    if (!target) return;
    if (notice && !notifiedLocations.current.has(location.pathname)) {
      notifiedLocations.current.add(location.pathname);
      showToast(notice, "info");
    }
    navigate(target, { replace: true });
  }, [
    archiveNavigation,
    associations,
    location.pathname,
    navigate,
    projects,
    rememberThreadLocation,
    setArchiveNavigation,
    showToast,
    threads,
    workspaces,
  ]);

  return null;
}

function WorkspaceRestoreRoute() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { workspaces, threads, lastThreadIdByWorkspace, activeWorkspaceId } = useAppState();
  const notifiedStaleThread = useRef(false);
  const target =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null;
  const rememberedThreadId = target ? lastThreadIdByWorkspace[target.id] : undefined;
  const rememberedThread = target
    ? threads.find(
        (thread) =>
          thread.id === rememberedThreadId && thread.workspaceId === target.id && !thread.archived,
      )
    : null;

  useEffect(() => {
    if (!target) return;
    if (rememberedThreadId && !rememberedThread && !notifiedStaleThread.current) {
      notifiedStaleThread.current = true;
      showToast("The last Thread could not be restored.", "info");
    }
    navigate(getWorkspaceRestorePath(target.id, threads, lastThreadIdByWorkspace), {
      replace: true,
    });
  }, [
    lastThreadIdByWorkspace,
    navigate,
    rememberedThread,
    rememberedThreadId,
    showToast,
    target,
    threads,
  ]);

  return target ? null : <FirstUsePage />;
}

function AppRoutes() {
  const { hasHydrated: hasThreadContentHydrated } = useThreadContent();
  const { hasHydrated, workspaces } = useAppState();
  useChatRun();

  if (!hasHydrated || !hasThreadContentHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <span className="text-app-14 text-subtle">Loading App State...</span>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <ToastProvider>
        <AppStateNotice />
        <MainWindowNavigation />
        <NavigationCoordinator />
        <FirstUsePage />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AppStateNotice />
      <MainWindowNavigation />
      <NavigationCoordinator />
      <DesktopShell>
        <Routes>
          <Route element={<WorkspaceRestoreRoute />} path="/" />
          <Route element={<WorkspaceOverviewPage />} path="/workspace/:workspaceId" />
          <Route
            element={<ProjectOverviewPage />}
            path="/workspace/:workspaceId/project/:projectId"
          />
          <Route
            element={<ThreadPage />}
            path="/workspace/:workspaceId/project/:projectId/thread/:threadId"
          />
          <Route element={null} path="/workspace/*" />
          <Route element={<Navigate replace to="/settings?tab=runtime" />} path="/runtimes" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </DesktopShell>
    </ToastProvider>
  );
}

function AppContent() {
  const { hasHydrated, recoveryDiagnostics } = useAppState();

  if (!hasHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <span className="text-app-14 text-subtle">Loading App State...</span>
      </div>
    );
  }

  if (recoveryDiagnostics) return <AppStateRecoveryPage />;

  return (
    <ThreadContentProvider>
      <SettingsProvider>
        <RuntimeModelsProvider>
          <AppRoutes />
        </RuntimeModelsProvider>
      </SettingsProvider>
    </ThreadContentProvider>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}
