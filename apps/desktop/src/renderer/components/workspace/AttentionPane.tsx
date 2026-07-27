import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { AppThreadRecord } from "../../../shared/workspacePersistence";
import { useAppState } from "../../context/AppStateContext";
import { buildThreadPath } from "../../lib/navigation";
import type { AttentionStatus } from "../../lib/projectThreads";

export type AttentionEntry = Pick<AppThreadRecord, "id" | "workspaceId" | "projectId" | "title"> & {
  workspaceName: string;
  projectName: string;
};

export type AttentionGroup = {
  status: AttentionStatus;
  threads: AttentionEntry[];
};

export type AttentionViewState = {
  scrollTop: number;
  selectedThreadId: string | null;
  groups: AttentionGroup[] | null;
};

function isAttentionGroup(value: unknown): value is AttentionGroup {
  if (!value || typeof value !== "object") return false;
  if (
    !("status" in value) ||
    (value.status !== "approval" && value.status !== "question" && value.status !== "failed") ||
    !("threads" in value) ||
    !Array.isArray(value.threads)
  ) {
    return false;
  }
  return value.threads.every(
    (thread) =>
      thread &&
      typeof thread === "object" &&
      "id" in thread &&
      typeof thread.id === "string" &&
      "workspaceId" in thread &&
      typeof thread.workspaceId === "string" &&
      "projectId" in thread &&
      typeof thread.projectId === "string" &&
      "title" in thread &&
      typeof thread.title === "string" &&
      "workspaceName" in thread &&
      typeof thread.workspaceName === "string" &&
      "projectName" in thread &&
      typeof thread.projectName === "string",
  );
}

export function getAttentionViewState(state: unknown): AttentionViewState | null {
  if (!state || typeof state !== "object" || !("attentionView" in state)) return null;
  const value = state.attentionView;
  if (!value || typeof value !== "object") return null;
  return {
    scrollTop: "scrollTop" in value && typeof value.scrollTop === "number" ? value.scrollTop : 0,
    selectedThreadId:
      "selectedThreadId" in value && typeof value.selectedThreadId === "string"
        ? value.selectedThreadId
        : null,
    groups:
      "groups" in value && Array.isArray(value.groups) && value.groups.every(isAttentionGroup)
        ? value.groups
        : null,
  };
}

const GROUP_LABELS: Record<AttentionStatus, string> = {
  approval: "Waiting for approval",
  question: "Waiting for answer",
  failed: "Failed",
};

export function AttentionPane({ groups }: { groups: AttentionGroup[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectWorkspace } = useAppState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewState = getAttentionViewState(location.state);

  useLayoutEffect(() => {
    if (scrollRef.current && viewState) scrollRef.current.scrollTop = viewState.scrollTop;
  }, []);

  return (
    <aside
      aria-label="Attention View"
      className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar px-3 py-3"
    >
      <h2 className="text-app-13 font-semibold text-fg">Attention</h2>
      <div ref={scrollRef} className="mt-3 min-h-0 flex-1 overflow-y-auto" role="listbox">
        {groups.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <p className="text-app-13 font-medium text-muted">Nothing needs attention</p>
            <p className="mt-1 text-app-12 text-subtle">
              Approval requests, questions, and failed Threads will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.status}>
                <h3 className="px-2 pb-1 text-app-11 font-medium text-subtle">
                  {GROUP_LABELS[group.status]}
                </h3>
                <div className="space-y-0.5">
                  {group.threads.map((thread) => {
                    const selected = viewState?.selectedThreadId === thread.id;
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        role="option"
                        aria-label={thread.title}
                        aria-selected={selected}
                        onClick={async () => {
                          const nextState = {
                            ...(location.state && typeof location.state === "object"
                              ? location.state
                              : {}),
                            attentionView: {
                              scrollTop: scrollRef.current?.scrollTop ?? 0,
                              selectedThreadId: thread.id,
                              groups,
                            },
                          };
                          navigate(`${location.pathname}${location.search}`, {
                            replace: true,
                            state: nextState,
                          });
                          await selectWorkspace(thread.workspaceId);
                          navigate(
                            buildThreadPath(thread.workspaceId, thread.projectId, thread.id),
                          );
                        }}
                        className={`w-full rounded-md px-2 py-2 text-left hover:bg-surface-hover ${
                          selected ? "bg-surface-hover" : ""
                        }`}
                      >
                        <span className="block truncate text-app-12 font-medium text-fg">
                          {thread.title}
                        </span>
                        <span className="mt-0.5 block truncate text-app-11 text-subtle">
                          {thread.workspaceName} / {thread.projectName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
