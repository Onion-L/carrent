import {
  Bot,
  Monitor,
  Settings,
  ArrowUpDown,
  Plus,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  SquarePen,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { currentProject, threads } from "../mock/uiShellData";

const workspaceNavItems = [
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/runtimes", label: "Runtimes", icon: Monitor },
];

export function SidebarNav() {
  const navigate = useNavigate();
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState(
    threads.find((t) => t.active)?.id ?? threads[0]?.id,
  );

  const handleThreadClick = (threadId: string) => {
    setActiveThreadId(threadId);
    navigate("/");
  };

  return (
    <aside
      className="flex h-full flex-col bg-[#1e1e1e]"
      style={{ paddingTop: "env(titlebar-area-height, 38px)" }}
    >
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
            <button className="flex h-5 w-5 items-center justify-center rounded text-[#666] transition hover:bg-[#2a2a2a] hover:text-[#999]">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-2 pb-2">
          <button
            onClick={() => setProjectExpanded(!projectExpanded)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-[#2a2a2a]"
          >
            {projectExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#666]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#666]" />
            )}
            <FolderOpen className="h-4 w-4 text-[#888]" />
            <span className="flex-1 text-[13px] font-medium text-[#ddd]">
              {currentProject.name}
            </span>
          </button>

          {projectExpanded && (
            <div className="ml-5">
              {threads.map((thread) => {
                const isActive = thread.id === activeThreadId;
                return (
                  <button
                    key={thread.id}
                    onClick={() => handleThreadClick(thread.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left transition ${
                      isActive
                        ? "bg-[#2a2a2a] text-[#eee]"
                        : "text-[#999] hover:bg-[#252525] hover:text-[#ccc]"
                    }`}
                  >
                    <span className="truncate text-[13px]">{thread.title}</span>
                    <span className="shrink-0 text-[11px] text-[#555]">{thread.updatedAt}</span>
                  </button>
                );
              })}
            </div>
          )}
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
