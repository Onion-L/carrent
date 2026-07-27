import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { AppProjectRecord } from "../../../shared/workspacePersistence";
import { useAppState } from "../../context/AppStateContext";

export function ProjectDirectoryUnavailable({
  project,
  breadcrumb,
  hasLiveRun,
}: {
  project: AppProjectRecord;
  breadcrumb: string;
  hasLiveRun: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { recheckProjectDirectory, relocateProject, projectDirectoryStatusById } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const checking = projectDirectoryStatusById[project.id] === "checking";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-8 py-5">
        <p className="truncate text-app-12 text-subtle">{breadcrumb}</p>
        <h1 className="mt-1 truncate text-app-18 font-semibold text-fg">{project.name}</h1>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        <div className="w-full max-w-lg text-center">
          <h2 className="text-app-15 font-semibold text-fg">
            Project Working Directory is unavailable
          </h2>
          <p className="mt-2 break-all text-app-12 text-muted">{project.workingDirectory}</p>
          <p className="mt-3 text-app-12 text-muted">
            History is preserved, but Carrent cannot start a new Run until this directory is
            available.
          </p>
          {error && <p className="mt-3 text-app-12 text-danger">{error}</p>}
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              disabled={checking}
              onClick={() => {
                setError(null);
                void recheckProjectDirectory(project.id).then((available) => {
                  if (available) {
                    navigate(`${location.pathname}${location.search}`, { replace: true });
                  }
                });
              }}
              className="min-h-8 rounded-md border border-border-strong px-3 text-app-12 font-medium text-fg hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Recheck
            </button>
            <button
              type="button"
              disabled={checking || hasLiveRun}
              title={hasLiveRun ? "Stop the Project's live Run before relocating" : undefined}
              onClick={() => {
                setError(null);
                void window.carrent.dialog
                  .openDirectory()
                  .then(async (selection) => {
                    const targetDirectory = selection.filePaths[0];
                    if (selection.canceled || !targetDirectory) return;
                    const result = await relocateProject(project.id, targetDirectory);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    navigate(`${location.pathname}${location.search}`, { replace: true });
                  })
                  .catch((caught) => {
                    setError(
                      caught instanceof Error ? caught.message : "Directory could not be selected.",
                    );
                  });
              }}
              className="min-h-8 rounded-md bg-fg px-3 text-app-12 font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Relocate Directory
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
