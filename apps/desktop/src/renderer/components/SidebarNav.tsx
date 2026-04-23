import {
  MessageSquare,
  Bot,
  Monitor,
  Settings,
  Search,
  ArrowUpDown,
  Plus,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  SquarePen,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useState } from "react";
import { currentProject, threads } from "../mock/uiShellData";

const navItems = [
  { to: "/", label: "Chat", icon: MessageSquare },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/runtimes", label: "Runtimes", icon: Monitor },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState(
    threads.find((t) => t.active)?.id ?? threads[0]?.id
  );

  return (
    <aside className="flex h-full flex-col border-r border-[#252525] bg-[#181818]">
      {/* ---- Top: Projects section (max 50%, scroll if overflow) ---- */}
      <div className="flex max-h-[50%] flex-col">
        {/* Search */}
        <div className="px-3 py-2">
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[14px] transition hover:bg-[#252525]">
            <Search className="h-4 w-4 text-[#666]" />
            <span className="flex-1 text-left text-[#888]">Search</span>
            <kbd className="rounded bg-[#252525] px-1.5 py-0.5 text-[11px] font-medium text-[#666]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* PROJECTS header */}
        <div className="flex items-center justify-between px-4 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666]">
            Projects
          </span>
          <div className="flex items-center gap-1">
            <button className="flex h-6 w-6 items-center justify-center rounded text-[#666] transition hover:bg-[#252525] hover:text-[#999]">
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>
            <button className="flex h-6 w-6 items-center justify-center rounded text-[#666] transition hover:bg-[#252525] hover:text-[#999]">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Project tree */}
        <div className="flex-1 overflow-auto px-2 pb-2">
          {/* Project folder row */}
          <button
            onClick={() => setProjectExpanded(!projectExpanded)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-[#252525]"
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
            <button className="flex h-6 w-6 items-center justify-center rounded text-[#555] transition hover:text-[#888]">
              <SquarePen className="h-3.5 w-3.5" />
            </button>
          </button>

          {/* Expanded threads */}
          {projectExpanded && (
            <div className="ml-5">
              {threads.map((thread) => {
                const isActive = thread.id === activeThreadId;
                return (
                  <button
                    key={thread.id}
                    onClick={() => setActiveThreadId(thread.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left transition ${
                      isActive
                        ? "bg-[#2a2a2a] text-[#eee]"
                        : "text-[#999] hover:bg-[#222] hover:text-[#ccc]"
                    }`}
                  >
                    <span className="text-[13px]">{thread.title}</span>
                    <span className="text-[11px] text-[#555]">
                      {thread.updatedAt}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---- Bottom: Navigation (fills remaining space) ---- */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666]">
            Workspace
          </span>
        </div>
        <nav className="flex-1 overflow-auto px-2 pt-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition ${
                  isActive
                    ? "bg-[#2a2a2a] font-medium text-[#eee]"
                    : "text-[#999] hover:bg-[#222] hover:text-[#ccc]"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom spacer */}
        <div className="h-4" />
      </div>
    </aside>
  );
}
