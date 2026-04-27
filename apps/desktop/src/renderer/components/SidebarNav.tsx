import {
  Bot,
  Monitor,
  Settings,
  ArrowUpDown,
  Plus,
  FolderOpen,
  Folder,
  Pin,
  MoreHorizontal,
  Archive,
  SquarePen,
  ExternalLink,
  Link,
  Trash2,
  Pencil,
  MessageSquare,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useDraftThread } from "../context/DraftThreadContext";
import { useToast } from "../components/toast/ToastContext";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import { splitProjectThreads } from "../lib/projectThreads";

const workspaceNavItems = [
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/runtimes", label: "Runtimes", icon: Monitor },
];

export function buildThreadPath(projectId: string, threadId: string) {
  return `/thread/${projectId}/${threadId}`;
}

export function buildDraftPath(draftId: string) {
  return `/draft/${draftId}`;
}

export function buildChatPath(threadId: string) {
  return `/chat/${threadId}`;
}

export function SidebarNav() {
  const navigate = useNavigate();
  const {
    projects,
    chats,
    activeThreadId,
    setActiveThreadId,
    createProject,
    removeProject,
    renameProject,
    toggleThreadPin,
    archiveThread,
    createChat,
    toggleChatPin,
    archiveChat,
  } = useWorkspace();
  const { createDraft } = useDraftThread();
  const { showToast } = useToast();
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(
    projects.filter((p) => p.active).map((p) => p.id),
  );
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [openThreadMenuId, setOpenThreadMenuId] = useState<string | null>(null);
  const [openChatMenuId, setOpenChatMenuId] = useState<string | null>(null);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");

  const handleThreadClick = (projectId: string, threadId: string) => {
    setActiveThreadId(threadId);
    navigate(buildThreadPath(projectId, threadId));
  };

  const handleChatClick = (threadId: string) => {
    setActiveThreadId(threadId);
    navigate(buildChatPath(threadId));
  };

  const handleNewChat = () => {
    const thread = createChat("New chat");
    if (thread) {
      navigate(buildChatPath(thread.id));
    }
  };

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId],
    );
  };

  const openDraft = (projectId: string) => {
    const draft = createDraft(projectId);
    if (!draft) {
      return;
    }

    setExpandedProjectIds((prev) => (prev.includes(projectId) ? prev : [...prev, projectId]));
    navigate(buildDraftPath(draft.draftId));
  };

  useEffect(() => {
    if (!openThreadMenuId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside =
        target instanceof Element &&
        target.closest('[data-thread-menu="true"], [data-thread-menu-trigger="true"]');
      if (!inside) {
        setOpenThreadMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openThreadMenuId]);

  useEffect(() => {
    if (!openProjectMenuId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside =
        target instanceof Element &&
        target.closest('[data-project-menu="true"], [data-project-menu-trigger="true"]');
      if (!inside) {
        setOpenProjectMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openProjectMenuId]);

  useEffect(() => {
    if (!openChatMenuId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside =
        target instanceof Element &&
        target.closest('[data-chat-menu="true"], [data-chat-menu-trigger="true"]');
      if (!inside) {
        setOpenChatMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openChatMenuId]);

  const togglePin = (projectId: string, threadId: string) => {
    toggleThreadPin(projectId, threadId);
    setOpenThreadMenuId(null);
  };

  const archiveThreadAction = (projectId: string, threadId: string) => {
    if (!window.confirm("Archive this thread?")) return;

    setOpenThreadMenuId(null);
    const nextActiveThreadId = archiveThread(projectId, threadId);
    if (activeThreadId === threadId) {
      if (nextActiveThreadId) {
        navigate(`/thread/${projectId}/${nextActiveThreadId}`);
      } else {
        navigate("/");
      }
    }
  };

  const archiveChatAction = (threadId: string) => {
    if (!window.confirm("Archive this chat?")) return;

    setOpenChatMenuId(null);
    archiveChat(threadId);
    if (activeThreadId === threadId) {
      navigate("/");
    }
  };

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="drag-region shrink-0" style={{ height: "env(titlebar-area-height, 38px)" }} />
      {/* Workspace section */}
      <div className="flex flex-col shrink-0">
        <div className="flex items-center px-4 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
            Workspace
          </span>
        </div>
        <nav className="px-2 pt-1 pb-2">
          {workspaceNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition ${
                  isActive
                    ? "bg-surface-hover font-medium text-fg"
                    : "text-muted hover:bg-surface-raised hover:text-fg"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Projects + Chat scrollable area */}
      <div className="flex-1 overflow-auto min-h-0">
        {/* Projects section */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-4 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              Projects
            </span>
            <div className="flex items-center gap-1">
              <button className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-muted">
                <ArrowUpDown className="h-3 w-3" />
              </button>
              <button
                onClick={async () => {
                  const result = await window.carrent.dialog.openDirectory();
                  if (!result.canceled && result.filePaths.length > 0) {
                    const newProject = createProject(result.filePaths[0]);
                    if (newProject) {
                      setExpandedProjectIds((prev) =>
                        prev.includes(newProject.id) ? prev : [...prev, newProject.id],
                      );
                    }
                  }
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-muted"
                title="New project"
              >
                <SquarePen className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="px-2 pb-2 mt-1">
            {projects.map((project) => {
              const isExpanded = expandedProjectIds.includes(project.id);
              const { active } = splitProjectThreads(project.threads);

              return (
                <div key={project.id}>
                  <div
                    className="relative flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover"
                    onMouseEnter={() => setHoveredProjectId(project.id)}
                    onMouseLeave={() =>
                      setHoveredProjectId((prev) => (prev === project.id ? null : prev))
                    }
                  >
                    {editingProjectId === project.id ? (
                      <input
                        autoFocus
                        value={editingProjectName}
                        onChange={(e) => setEditingProjectName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            renameProject(project.id, editingProjectName);
                            setEditingProjectId(null);
                            setEditingProjectName("");
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingProjectId(null);
                            setEditingProjectName("");
                          }
                        }}
                        onBlur={() => {
                          renameProject(project.id, editingProjectName);
                          setEditingProjectId(null);
                          setEditingProjectName("");
                        }}
                        className="flex-1 bg-transparent text-[13px] text-fg outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => toggleProjectExpanded(project.id)}
                        className="flex flex-1 items-center gap-1.5 text-left"
                      >
                        {isExpanded ? (
                          <FolderOpen className="h-4 w-4 text-muted" />
                        ) : (
                          <Folder className="h-4 w-4 text-muted" />
                        )}
                        <span className="text-[13px] font-medium text-fg">{project.name}</span>
                      </button>
                    )}
                    {hoveredProjectId === project.id && editingProjectId !== project.id && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDraft(project.id);
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-muted"
                          title="New thread"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          data-project-menu-trigger="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenProjectMenuId(
                              openProjectMenuId === project.id ? null : project.id,
                            );
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-muted"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </button>
                      </>
                    )}

                    {openProjectMenuId === project.id && (
                      <div
                        data-project-menu="true"
                        className="absolute right-0 top-full z-10 mt-0.5 w-44 rounded-md border border-border-strong bg-surface-raised py-1 shadow-lg"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void window.carrent.shell.openPath(project.path);
                            setOpenProjectMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open in Finder
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenProjectMenuId(null);
                            setEditingProjectId(project.id);
                            setEditingProjectName(project.name);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                        >
                          <Pencil className="h-3 w-3" />
                          Rename project
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.carrent.clipboard.writeText(project.path);
                            setOpenProjectMenuId(null);
                            showToast("Path copied to clipboard", "success");
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                        >
                          <Link className="h-3 w-3" />
                          Copy location
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete "${project.name}"?`)) {
                              removeProject(project.id);
                            }
                            setOpenProjectMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger transition hover:bg-surface-hover"
                        >
                          <Trash2 className="h-3 w-3 text-danger" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="ml-5 mt-1">
                      {active.map((thread) => {
                        const isActive = thread.id === activeThreadId;
                        const showActions = isActive || hoveredThreadId === thread.id;
                        const menuOpen = openThreadMenuId === thread.id;

                        return (
                          <div
                            key={thread.id}
                            className={`relative mt-0.5 flex items-center justify-between rounded-md px-3 py-1.5 text-left transition ${
                              isActive
                                ? "bg-surface-hover text-fg"
                                : "text-muted hover:bg-surface-raised hover:text-fg"
                            }`}
                            onMouseEnter={() => setHoveredThreadId(thread.id)}
                            onMouseLeave={() =>
                              setHoveredThreadId((prev) => (prev === thread.id ? null : prev))
                            }
                          >
                            <button
                              onClick={() => handleThreadClick(project.id, thread.id)}
                              className="flex flex-1 items-center justify-between text-left"
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                {thread.pinned && <Pin className="h-3 w-3 text-muted" />}
                                <span className="truncate text-[13px]">{thread.title}</span>
                              </span>
                              {!showActions && (
                                <span className="shrink-0 text-[11px] text-subtle">
                                  {formatRelativeTime(thread.updatedAt)}
                                </span>
                              )}
                            </button>
                            {showActions && (
                              <button
                                data-thread-menu-trigger="true"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenThreadMenuId(menuOpen ? null : thread.id);
                                }}
                                className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-muted"
                              >
                                <MoreHorizontal className="h-3 w-3" />
                              </button>
                            )}

                            {menuOpen && (
                              <div
                                data-thread-menu="true"
                                className="absolute right-0 top-full z-10 mt-0.5 w-32 rounded-md border border-border-strong bg-surface-raised py-1 shadow-lg"
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePin(project.id, thread.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                                >
                                  <Pin className="h-3 w-3" />
                                  {thread.pinned ? "Unpin" : "Pin"}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    archiveThreadAction(project.id, thread.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger transition hover:bg-surface-hover"
                                >
                                  <Archive className="h-3 w-3 text-danger" />
                                  Archive
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat section */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-4 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              Chat
            </span>
            <button
              onClick={handleNewChat}
              className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-muted"
              title="New chat"
            >
              <SquarePen className="h-3 w-3" />
            </button>
          </div>
          <div className="px-2 pb-2">
            {splitProjectThreads(chats).active.map((chat) => {
              const isActive = chat.id === activeThreadId;
              const showActions = isActive || hoveredChatId === chat.id;
              const menuOpen = openChatMenuId === chat.id;

              return (
                <div
                  key={chat.id}
                  className={`relative mt-0.5 flex items-center justify-between rounded-md px-3 py-1.5 text-left transition ${
                    isActive
                      ? "bg-surface-hover text-fg"
                      : "text-muted hover:bg-surface-raised hover:text-fg"
                  }`}
                  onMouseEnter={() => setHoveredChatId(chat.id)}
                  onMouseLeave={() => setHoveredChatId((prev) => (prev === chat.id ? null : prev))}
                >
                  <button
                    onClick={() => handleChatClick(chat.id)}
                    className="flex flex-1 items-center justify-between text-left"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {chat.pinned && <Pin className="h-3 w-3 text-muted" />}
                      <MessageSquare className="h-3 w-3 text-muted" />
                      <span className="truncate text-[13px]">{chat.title}</span>
                    </span>
                    {!showActions && (
                      <span className="shrink-0 text-[11px] text-subtle">
                        {formatRelativeTime(chat.updatedAt)}
                      </span>
                    )}
                  </button>
                  {showActions && (
                    <button
                      data-chat-menu-trigger="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenChatMenuId(menuOpen ? null : chat.id);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:bg-surface-hover hover:text-muted"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </button>
                  )}

                  {menuOpen && (
                    <div
                      data-chat-menu="true"
                      className="absolute right-0 top-full z-10 mt-0.5 w-32 rounded-md border border-border-strong bg-surface-raised py-1 shadow-lg"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleChatPin(chat.id);
                          setOpenChatMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg transition hover:bg-surface-hover"
                      >
                        <Pin className="h-3 w-3" />
                        {chat.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          archiveChatAction(chat.id);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger transition hover:bg-surface-hover"
                      >
                        <Archive className="h-3 w-3 text-danger" />
                        Archive
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="shrink-0 px-2 pb-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition ${
              isActive
                ? "bg-surface-hover font-medium text-fg"
                : "text-muted hover:bg-surface-raised hover:text-fg"
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
