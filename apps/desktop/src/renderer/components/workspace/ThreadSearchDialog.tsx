import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type {
  AppProjectRecord,
  AppThreadRecord,
  WorkspaceProjectAssociationRecord,
  WorkspaceRecord,
} from "../../../shared/workspacePersistence";
import type { ThreadSearchEntry, ThreadSearchScope } from "../../../shared/threadSearch";
import { searchThreads } from "../../lib/threadSearch";

type ThreadSearchDialogProps = {
  threads: AppThreadRecord[];
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  scope: ThreadSearchScope;
  workspaceScope: Extract<ThreadSearchScope, { kind: "workspace" }> | null;
  associationScope: Extract<ThreadSearchScope, { kind: "association" }> | null;
  onScopeChange: (scope: ThreadSearchScope) => void;
  onSelect: (entry: ThreadSearchEntry) => void;
  onClose: () => void;
};

function getScopeLabel(
  scope: ThreadSearchScope,
  workspaces: WorkspaceRecord[],
  projects: AppProjectRecord[],
  associations: WorkspaceProjectAssociationRecord[],
) {
  if (scope.kind === "global") return "Global";
  const workspace = workspaces.find((item) => item.id === scope.workspaceId);
  if (!workspace) return "Workspace";
  if (scope.kind === "workspace") return workspace.name;
  const project = projects.find((item) => item.id === scope.projectId);
  const association = associations.find(
    (item) => item.workspaceId === scope.workspaceId && item.projectId === scope.projectId,
  );
  return project && association
    ? `${workspace.name} / ${association.alias ?? project.name}`
    : workspace.name;
}

export function ThreadSearchDialog({
  threads,
  workspaces,
  projects,
  associations,
  scope,
  workspaceScope,
  associationScope,
  onScopeChange,
  onSelect,
  onClose,
}: ThreadSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scopeLabel = getScopeLabel(scope, workspaces, projects, associations);
  const selectedWorkspaceId =
    scope.kind === "global" ? workspaceScope?.workspaceId : scope.workspaceId;
  const availableWorkspaceScope = selectedWorkspaceId
    ? ({ kind: "workspace", workspaceId: selectedWorkspaceId } as const)
    : workspaces[0]
      ? ({ kind: "workspace", workspaceId: workspaces[0].id } as const)
      : null;
  const availableAssociationScope =
    scope.kind === "association"
      ? scope
      : (associationScope ??
        associations
          .filter(
            (association) =>
              !availableWorkspaceScope ||
              association.workspaceId === availableWorkspaceScope.workspaceId,
          )
          .map(
            (association) =>
              ({
                kind: "association",
                workspaceId: association.workspaceId,
                projectId: association.projectId,
              }) as const,
          )[0] ??
        null);
  const associationOptions = associations.flatMap((association) => {
    const workspace = workspaces.find((item) => item.id === association.workspaceId);
    const project = projects.find((item) => item.id === association.projectId);
    return workspace && project
      ? [
          {
            value: `${association.workspaceId}\u0000${association.projectId}`,
            label: `${workspace.name} / ${association.alias ?? project.name}`,
            scope: {
              kind: "association",
              workspaceId: association.workspaceId,
              projectId: association.projectId,
            } as const,
          },
        ]
      : [];
  });
  const results = useMemo(
    () => searchThreads({ threads, workspaces, projects, associations, query, scope }),
    [associations, projects, query, scope, threads, workspaces],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => setSelectedIndex(0), [query, scope]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Threads"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border-strong bg-surface shadow-xl"
      >
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Search className="h-4 w-4 shrink-0 text-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedIndex((index) =>
                    results.length === 0 ? 0 : (index + 1) % results.length,
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedIndex((index) =>
                    results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const result = results[selectedIndex] ?? results[0];
                  if (result) onSelect(result);
                }
              }}
              placeholder="Search Thread titles"
              aria-label="Search Thread titles"
              className="min-w-0 flex-1 bg-transparent text-app-14 text-fg outline-none placeholder:text-subtle"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => setQuery("")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-1" aria-label="Search scope">
            {[
              { label: "Global", value: { kind: "global" } as ThreadSearchScope, disabled: false },
              {
                label: "Workspace",
                value: availableWorkspaceScope,
                disabled: !availableWorkspaceScope,
              },
              {
                label: "Project",
                value: availableAssociationScope,
                disabled: !availableAssociationScope,
              },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={option.disabled}
                aria-pressed={option.value?.kind === scope.kind}
                onClick={() => option.value && onScopeChange(option.value)}
                className="min-h-7 rounded-md px-2.5 text-app-11 text-muted hover:bg-surface-hover hover:text-fg disabled:opacity-35 aria-pressed:bg-surface-hover aria-pressed:text-fg"
              >
                {option.label}
              </button>
            ))}
            <span className="ml-auto min-w-0 truncate pl-2 text-app-11 text-subtle">
              Scope: {scopeLabel}
            </span>
          </div>
          {scope.kind === "workspace" && (
            <select
              aria-label="Workspace search scope"
              value={scope.workspaceId}
              onChange={(event) =>
                onScopeChange({ kind: "workspace", workspaceId: event.target.value })
              }
              className="mt-2 h-8 w-full rounded-md border border-border bg-bg px-2 text-app-11 text-fg outline-none focus:border-border-strong"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          )}
          {scope.kind === "association" && (
            <select
              aria-label="Project search scope"
              value={`${scope.workspaceId}\u0000${scope.projectId}`}
              onChange={(event) => {
                const option = associationOptions.find((item) => item.value === event.target.value);
                if (option) onScopeChange(option.scope);
              }}
              className="mt-2 h-8 w-full rounded-md border border-border bg-bg px-2 text-app-11 text-fg outline-none focus:border-border-strong"
            >
              {associationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-app-13 font-medium text-muted">
                {query.trim() ? "No matching Threads" : "No recent Threads"}
              </p>
              <p className="mt-1 text-app-11 text-subtle">Scope: {scopeLabel}</p>
            </div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.thread.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelect(entry)}
                className={`w-full rounded-md px-3 py-2.5 text-left ${
                  index === selectedIndex
                    ? "bg-surface-hover text-fg"
                    : "text-muted hover:bg-surface-hover hover:text-fg"
                }`}
              >
                <span className="block truncate text-app-12 font-medium">
                  {entry.workspaceName} / {entry.projectName} / {entry.thread.title}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
