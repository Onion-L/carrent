import {
  Bot,
  Monitor,
  Settings,
  ArrowUpDown,
  Plus,
  FolderOpen,
  Folder,
  SquarePen,
  Pin,
  MoreHorizontal,
  Archive,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { projects } from "../mock/uiShellData";
import { useActiveThread } from "../context/ActiveThreadContext";
import { splitProjectThreads } from "../lib/projectThreads";

const workspaceNavItems = [
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/runtimes", label: "Runtimes", icon: Monitor },
];

export function SidebarNav() {
  const navigate = useNavigate();
  const { activeThreadId, setActiveThreadId } = useActiveThread();
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(
    projects.filter((p) => p.active).map((p) => p.id),
  );
  const [projectThreadsMap, setProjectThreadsMap] = useState(() =>
    Object.fromEntries(projects.map((p) => [p.id, p.threads])),
  );
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [draftThreadTitle, setDraftThreadTitle] = useState("");
  const draftInputRef = useRef<HTMLInputElement>(null);
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [openThreadMenuId, setOpenThreadMenuId] = useState<string | null>(null);
  const [expandedArchivedProjectIds, setExpandedArchivedProjectIds] = useState<
    string[]
  >([]);

  const handleThreadClick = (threadId: string) => {
    setActiveThreadId(threadId);
    navigate("/");
  };

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  };

  const openDraft = (projectId: string) => {
    setDraftProjectId(projectId);
    setDraftThreadTitle("");
    // ensure project is expanded so draft is visible
    setExpandedProjectIds((prev) =>
      prev.includes(projectId) ? prev : [...prev, projectId],
    );
  };

  const cancelDraft = () => {
    setDraftProjectId(null);
    setDraftThreadTitle("");
  };

  const saveDraft = () => {
    const title = draftThreadTitle.trim();
    if (!title || !draftProjectId) return;

    const newThread = {
      id: `thread-${Date.now()}`,
      title,
      updatedAt: "now",
    };

    setProjectThreadsMap((prev) => ({
      ...prev,
      [draftProjectId]: [newThread, ...(prev[draftProjectId] ?? [])],
    }));
    setActiveThreadId(newThread.id);
    setDraftProjectId(null);
    setDraftThreadTitle("");
    navigate("/");
  };

  useEffect(() => {
    if (draftProjectId && draftInputRef.current) {
      draftInputRef.current.focus();
    }
  }, [draftProjectId]);

  const togglePin = (projectId: string, threadId: string) => {
    setProjectThreadsMap((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] ?? []).map((t) =>
        t.id === threadId ? { ...t, pinned: !t.pinned } : t,
      ),
    }));
    setOpenThreadMenuId(null);
  };

  const archiveThreadAction = (projectId: string, threadId: string) => {
    setOpenThreadMenuId(null);

    const currentThreads = projectThreadsMap[projectId] ?? [];
    const nextThreads = currentThreads.map((t) =>
      t.id === threadId ? { ...t, archived: true } : t,
    );

    setProjectThreadsMap((prev) => ({
      ...prev,
      [projectId]: nextThreads,
    }));

    if (activeThreadId === threadId) {
      const { active: nextActive } = splitProjectThreads(
        nextThreads.filter((t) => t.id !== threadId),
      );
      setActiveThreadId(nextActive[0]?.id ?? null);
    }
  };

  const toggleArchivedExpanded = (projectId: string) => {
    setExpandedArchivedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId],
    );
  };

  return (
    <aside className="flex h-full flex-col bg-[#1e1e1e]">
      <div
        className="drag-region shrink-0"
        style={{ height: "env(titlebar-area-height, 38px)" }}
      />
      {/* Projects section */}
      <div className="flex max-h-[50%] flex-col">
        <div className="flex items-center justify-between px-4 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666]">
            Projects
          </span>
          <div className="flex items-center gap-1">
            <button className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]">
              <ArrowUpDown className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-2 pb-2 mt-1">
          {projects.map((project) => {
            const isExpanded = expandedProjectIds.includes(project.id);
            const threads = projectThreadsMap[project.id] ?? [];
            const { active, archived } = splitProjectThreads(threads);
            const isArchivedExpanded = expandedArchivedProjectIds.includes(
              project.id,
            );

            return (
              <div key={project.id}>
                <button
                  onClick={() => toggleProjectExpanded(project.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-[#2a2a2a]"
                >
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 text-[#888]" />
                  ) : (
                    <Folder className="h-4 w-4 text-[#888]" />
                  )}
                  <span className="flex-1 text-[13px] font-medium text-[#ddd]">
                    {project.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openDraft(project.id);
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#333] hover:text-[#999]"
                    title="New thread"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </button>

                {isExpanded && (
                  <div className="ml-5 mt-1">
                    {draftProjectId === project.id && (
                      <div className="flex w-full items-center rounded-md px-3 py-1.5 bg-[#252525] mt-0.5">
                        <input
                          ref={draftInputRef}
                          value={draftThreadTitle}
                          onChange={(e) => setDraftThreadTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveDraft();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelDraft();
                            }
                          }}
                          placeholder="Thread title..."
                          className="flex-1 bg-transparent text-[13px] text-[#ddd] placeholder-[#555] outline-none"
                        />
                      </div>
                    )}
                    {active.map((thread) => {
                      const isActive = thread.id === activeThreadId;
                      const showActions =
                        isActive || hoveredThreadId === thread.id;
                      const menuOpen = openThreadMenuId === thread.id;

                      return (
                        <div key={thread.id} className="relative mt-0.5">
                          <button
                            onClick={() => handleThreadClick(thread.id)}
                            onMouseEnter={() => setHoveredThreadId(thread.id)}
                            onMouseLeave={() =>
                              setHoveredThreadId((prev) =>
                                prev === thread.id ? null : prev,
                              )
                            }
                            className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left transition ${
                              isActive
                                ? "bg-[#2a2a2a] text-[#eee]"
                                : "text-[#999] hover:bg-[#252525] hover:text-[#ccc]"
                            }`}
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              {thread.pinned && (
                                <Pin className="h-3 w-3 text-[#888]" />
                              )}
                              <span className="truncate text-[13px]">
                                {thread.title}
                              </span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="shrink-0 text-[11px] text-[#555]">
                                {thread.updatedAt}
                              </span>
                              {showActions && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenThreadMenuId(
                                      menuOpen ? null : thread.id,
                                    );
                                  }}
                                  className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#333] hover:text-[#999]"
                                >
                                  <MoreHorizontal className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          </button>

                          {menuOpen && (
                            <div className="absolute right-0 top-full z-10 mt-0.5 w-32 rounded-md border border-[#333] bg-[#252525] py-1 shadow-lg">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePin(project.id, thread.id);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#ccc] transition hover:bg-[#333]"
                              >
                                <Pin className="h-3 w-3" />
                                {thread.pinned ? "Unpin" : "Pin"}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  archiveThreadAction(project.id, thread.id);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#ccc] transition hover:bg-[#333]"
                              >
                                <Archive className="h-3 w-3" />
                                Archive
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {archived.length > 0 && (
                      <button
                        onClick={() => toggleArchivedExpanded(project.id)}
                        className="mt-1 flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-left text-[12px] text-[#666] transition hover:text-[#999]"
                      >
                        <Archive className="h-3 w-3" />
                        <span>Archived ({archived.length})</span>
                      </button>
                    )}

                    {isArchivedExpanded && archived.length > 0 && (
                      <div className="mt-0.5 pl-2">
                        {archived.map((thread) => (
                          <div
                            key={thread.id}
                            className="flex w-full items-center rounded-md px-3 py-1 text-[12px] text-[#555]"
                          >
                            <span className="truncate">{thread.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Workspace section */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666]">
            Chats
          </span>
          <div className="flex items-center gap-1">
            <button className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]">
              <ArrowUpDown className="h-3 w-3" />
            </button>
            <button className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]">
              <SquarePen className="h-3 w-3" />
            </button>
          </div>
        </div>
        <nav className="flex-1 overflow-auto px-2 pt-1">
          {workspaceNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition ${
                  isActive
                    ? "bg-[#2a2a2a] font-medium text-[#eee]"
                    : "text-[#999] hover:bg-[#252525] hover:text-[#ccc]"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Settings */}
      <div className="px-2 pb-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition ${
              isActive
                ? "bg-[#2a2a2a] font-medium text-[#eee]"
                : "text-[#999] hover:bg-[#252525] hover:text-[#ccc]"
            }`
          }
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
