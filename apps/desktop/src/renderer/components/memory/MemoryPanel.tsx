import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen, RefreshCw, Trash2 } from "lucide-react";

import type { KimiMemoryFile, KimiMemoryIndex } from "../../../shared/kimiMemory";
import { formatAbsoluteTime, formatRelativeTime } from "../../lib/formatRelativeTime";
import { ConfirmDialog } from "../ConfirmDialog";
import { MarkdownContent } from "../chat/MarkdownContent";

const PRELOAD_RESTART_MESSAGE =
  "Kimi memory support is not loaded in the current window. Restart Carrent and try again.";

export type KimiMemorySettingsApi = {
  kimiMemory?: () => Promise<KimiMemoryIndex>;
  kimiMemoryDelete?: (filePath: string) => Promise<void>;
};

export type KimiMemoryShellApi = { revealPath?: (filePath: string) => Promise<unknown> };

export async function readKimiMemoryIndex(settingsApi: KimiMemorySettingsApi): Promise<{
  index: KimiMemoryIndex | null;
  error: string | null;
}> {
  if (typeof settingsApi.kimiMemory !== "function") {
    return { index: null, error: PRELOAD_RESTART_MESSAGE };
  }
  try {
    return { index: await settingsApi.kimiMemory(), error: null };
  } catch (error) {
    return {
      index: null,
      error: error instanceof Error ? error.message : "Failed to load Kimi Code memory.",
    };
  }
}

export async function deleteKimiMemoryEntry(
  settingsApi: KimiMemorySettingsApi,
  filePath: string,
): Promise<string | null> {
  if (typeof settingsApi.kimiMemoryDelete !== "function") {
    return PRELOAD_RESTART_MESSAGE;
  }
  try {
    await settingsApi.kimiMemoryDelete(filePath);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Failed to delete the memory file.";
  }
}

async function revealMemoryFile(
  shellApi: KimiMemoryShellApi,
  filePath: string,
): Promise<void> {
  if (typeof shellApi.revealPath !== "function") {
    throw new Error("Reveal in Finder support is not loaded. Restart Carrent and try again.");
  }
  await shellApi.revealPath(filePath);
}

type ViewMode = "preview" | "raw";

export function MemoryPanel() {
  return <MemoryPanelView api={window.carrent.settings} shellApi={window.carrent.shell} />;
}

export function MemoryPanelView({
  api,
  shellApi,
}: {
  api: KimiMemorySettingsApi;
  shellApi: KimiMemoryShellApi;
}) {
  const [index, setIndex] = useState<KimiMemoryIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewModeByPath, setViewModeByPath] = useState<Record<string, ViewMode>>({});
  const viewMode: ViewMode =
    selectedPath === null ? "preview" : (viewModeByPath[selectedPath] ?? "preview");
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeByPath((previous) =>
        selectedPath === null ? previous : { ...previous, [selectedPath]: mode },
      );
    },
    [selectedPath],
  );
  const [pendingDelete, setPendingDelete] = useState<KimiMemoryFile | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await readKimiMemoryIndex(api);
    setIndex(result.index);
    setError(result.error);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedFile = useMemo(() => {
    if (index === null) return null;
    const files = index.projects.flatMap((project) => project.files);
    if (files.length === 0) return null;
    return files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  }, [index, selectedPath]);

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const deleteError = await deleteKimiMemoryEntry(api, target.path);
    if (deleteError !== null) {
      setActionError(deleteError);
      return;
    }
    setActionError(null);
    if (selectedPath === target.path) setSelectedPath(null);
    await refresh();
  }, [pendingDelete, refresh, selectedPath, api]);

  if (loading && index === null && error === null) return <MemorySkeleton />;

  if (error !== null && index === null) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-6">
        <div className="text-app-13 text-fg">Could not load Kimi Code memory</div>
        <div className="mt-1 text-app-12 text-subtle">{error}</div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  const totalFiles = index?.projects.reduce((sum, project) => sum + project.files.length, 0) ?? 0;

  if (index === null || totalFiles === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-6">
        <div className="text-app-13 text-fg">No Kimi Code memory yet</div>
        <div className="mt-1 text-app-12 text-subtle">
          Kimi Code builds up cross-session memory per project as you work. Nothing has been
          remembered yet.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-app-12 text-subtle">
          Cross-session memory written by Kimi Code, grouped by project · {totalFiles}{" "}
          {totalFiles === 1 ? "file" : "files"}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
          title="Refresh memory index"
          aria-label="Refresh memory index"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {actionError !== null ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-app-12 text-danger">
          {actionError}
        </p>
      ) : null}

      {/* Master-detail: tonal separation instead of nested bordered boxes —
          the list is one rounded surface, the detail pane is bare canvas. */}
      <div className="flex h-[calc(100dvh-250px)] min-h-[480px] min-w-0 gap-4">
        <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg bg-surface">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1.5 py-1.5">
            {index.projects.map((project) => (
              <div key={project.key} className="flex flex-col gap-1.5">
                <div
                  className="truncate px-2 pb-0.5 pt-1.5 text-app-11 font-medium text-subtle"
                  title={project.key}
                >
                  {project.name}
                </div>
                {project.files.map((file) => {
                  const selected = selectedFile?.path === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      title={file.description}
                      className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150 ease-out ${
                        selected ? "bg-surface-hover" : "hover:bg-surface-hover/60"
                      }`}
                    >
                      <span
                        className={`truncate text-app-12 ${
                          selected ? "font-medium text-fg" : "text-fg"
                        }`}
                      >
                        {file.name}
                      </span>
                      <span className="truncate text-app-11 text-subtle">
                        {file.type} · {formatRelativeTime(file.modifiedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div
            className="shrink-0 px-2.5 py-1.5 text-app-10 text-subtle"
            title="The Kimi Code memory file format is not stable yet. This tab only manages content (view, reveal, delete); it does not change how memory is collected."
          >
            Beta · file format may change
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
          {selectedFile === null ? (
            <div className="flex flex-1 items-center justify-center text-app-12 text-subtle">
              Select a memory file
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-border px-5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-subtle" />
                    <span className="truncate text-app-13 font-medium text-fg">
                      {selectedFile.fileName}
                    </span>
                    <span
                      className="shrink-0 text-app-11 text-subtle"
                      title={formatAbsoluteTime(selectedFile.modifiedAt)}
                    >
                      {formatRelativeTime(selectedFile.modifiedAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="flex rounded-md border border-border bg-surface p-0.5">
                      {(["preview", "raw"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setViewMode(mode)}
                          className={`rounded px-2.5 py-1 text-app-12 capitalize ${
                            viewMode === mode
                              ? "bg-surface-hover text-fg"
                              : "text-subtle hover:text-muted"
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      aria-label={`Reveal ${selectedFile.fileName} in Finder`}
                      title="Reveal in Finder"
                      onClick={() => {
                        void revealMemoryFile(shellApi, selectedFile.path).catch((err) =>
                          setActionError(err instanceof Error ? err.message : String(err)),
                        );
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${selectedFile.fileName}`}
                      title="Delete"
                      onClick={() => setPendingDelete(selectedFile)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {selectedFile.description !== "" ? (
                  <div
                    className="mt-1 truncate text-app-11 text-subtle"
                    title={selectedFile.description}
                  >
                    {selectedFile.description}
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {viewMode === "preview" ? (
                  selectedFile.body === "" ? (
                    <span className="text-app-12 text-subtle">(empty)</span>
                  ) : (
                    <div className="max-w-[70ch]">
                      <div className="flex flex-col gap-2">
                        <MarkdownContent>{selectedFile.body}</MarkdownContent>
                      </div>
                    </div>
                  )
                ) : (selectedFile.raw ?? "") === "" ? (
                  <span className="text-app-12 text-subtle">(empty)</span>
                ) : (
                  <div className="font-mono text-app-12 leading-5">
                    <div className="sticky -top-4 z-10 -mx-5 mb-3 border-b border-border bg-bg px-5 pb-2 pt-4 font-mono text-app-12 text-subtle">
                      {selectedFile.fileName}
                    </div>
                    {(selectedFile.raw ?? selectedFile.body)
                      .replace(/\n+$/u, "")
                      .split("\n")
                      .map((line, lineIndex) => (
                        <div key={lineIndex} className="flex">
                          <span className="w-8 shrink-0 select-none pr-4 text-right tabular-nums text-subtle">
                            {lineIndex + 1}
                          </span>
                          <span className="whitespace-pre-wrap break-all text-muted">
                            {line === "" ? " " : line}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingDelete !== null ? (
        <ConfirmDialog
          title="Delete memory file"
          message={`Delete "${pendingDelete.fileName}"? Only this file is removed and this cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}

function MemorySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-48 rounded bg-surface" />
        <div className="h-8 w-8 rounded-md bg-surface" />
      </div>
      <div className="flex h-[calc(100dvh-250px)] min-h-[480px] min-w-0 gap-4">
        <div className="flex w-72 shrink-0 flex-col gap-1.5 rounded-lg bg-surface px-1.5 py-1.5">
          <div className="mb-1.5 h-3 w-20 rounded bg-surface-hover" />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex flex-col gap-1 rounded-md px-2.5 py-2">
              <div className="h-3.5 w-36 rounded bg-surface-hover" />
              <div className="h-3 w-24 rounded bg-surface-hover" />
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border px-1 py-2.5">
            <div className="h-4 w-40 rounded bg-surface" />
          </div>
          <div className="flex flex-col gap-2 px-5 py-4">
            {[0, 1, 2, 3, 4].map((line) => (
              <div
                key={line}
                className="h-3.5 rounded bg-surface"
                style={{ width: `${92 - line * 11}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
