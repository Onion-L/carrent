import { MessageSquare, Bot, Monitor, Settings, Plus } from "lucide-react";
import { NavLink } from "react-router-dom";
import { currentProject } from "../mock/uiShellData";

const navItems = [
  { to: "/", label: "Chat", icon: MessageSquare },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/runtimes", label: "Runtimes", icon: Monitor },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  return (
    <aside
      className="flex h-full w-[240px] flex-col border-r border-[#252525] bg-[#181818]"
      style={{ paddingTop: "env(titlebar-area-height, 38px)" }}
    >
      {/* Project header */}
      <div className="px-4 pb-2 pt-3">
        <div className="mb-1 text-[13px] font-semibold text-[#ddd]">
          {currentProject.name}
        </div>
        <div className="truncate text-[11px] text-[#666]" title={currentProject.path}>
          {currentProject.path}
        </div>
      </div>

      {/* New Thread */}
      <div className="px-3 py-2">
        <button className="flex w-full items-center gap-2 rounded-lg border border-[#333] bg-[#222] px-3 py-2 text-[13px] text-[#ccc] transition hover:bg-[#2a2a2a]">
          <Plus className="h-4 w-4 text-[#888]" />
          <span>New Thread</span>
        </button>
      </div>

      {/* Nav items */}
      <nav className="mt-2 flex-1 px-2">
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

      {/* Bottom spacer for visual balance */}
      <div className="h-4" />
    </aside>
  );
}
