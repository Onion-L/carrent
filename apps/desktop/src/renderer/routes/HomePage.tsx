import {
  ArrowUp,
  BookOpen,
  Bot,
  ChevronDown,
  GitBranch,
  Inbox,
  Kanban,
  LayoutList,
  Lock,
  Monitor,
  Plus,
  Search,
  Settings,
  SquarePen,
  UserCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */
function Sidebar() {
  const [activeItem, setActiveItem] = useState("Inbox");

  const navItems = [
    { id: "Inbox", icon: Inbox, label: "Inbox" },
    { id: "My Issues", icon: UserCircle, label: "My Issues" },
  ];

  const workspaceItems = [
    { id: "Issues", icon: LayoutList, label: "Issues" },
    { id: "Projects", icon: Kanban, label: "Projects" },
    { id: "Autopilot", icon: Zap, label: "Autopilot" },
    { id: "Agents", icon: Bot, label: "Agents" },
  ];

  const configureItems = [
    { id: "Runtimes", icon: Monitor, label: "Runtimes" },
    { id: "Skills", icon: BookOpen, label: "Skills" },
    { id: "Settings", icon: Settings, label: "Settings" },
  ];

  return (
    <aside
      className="flex h-full w-[240px] flex-col bg-[#181818] text-[#999]"
      style={{ paddingTop: "env(titlebar-area-height, 38px)" }}
    >
      {/* User switcher */}
      <div className="px-3 pt-2 pb-1">
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-[#252525]">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#333] text-[11px] font-semibold text-[#ccc]">
            O
          </div>
          <span className="flex-1 text-left text-[14px] font-medium text-[#ddd]">
            onion
          </span>
          <ChevronDown className="h-4 w-4 text-[#666]" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-1">
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[14px] transition hover:bg-[#252525]">
          <Search className="h-4 w-4 text-[#666]" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="rounded bg-[#252525] px-1.5 py-0.5 text-[11px] font-medium text-[#666]">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* New Issue */}
      <div className="px-3 py-1">
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[14px] transition hover:bg-[#252525]">
          <SquarePen className="h-4 w-4 text-[#666]" />
          <span className="flex-1 text-left">New Issue</span>
          <kbd className="rounded bg-[#252525] px-1.5 py-0.5 text-[11px] font-medium text-[#666]">
            C
          </kbd>
        </button>
      </div>

      {/* Main nav */}
      <div className="mt-1 px-2">
        {navItems.map((item) => {
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveItem(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[14px] transition ${
                isActive
                  ? "bg-[#2a2a2a] font-medium text-[#eee]"
                  : "text-[#999] hover:bg-[#222] hover:text-[#ccc]"
              }`}
            >
              <item.icon
                className={`h-4 w-4 ${isActive ? "text-[#ccc]" : "text-[#666]"}`}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Workspace section */}
      <div className="mt-4 px-4">
        <span className="text-[12px] font-medium text-[#666]">Workspace</span>
      </div>
      <div className="mt-1 px-2">
        {workspaceItems.map((item) => {
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveItem(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[14px] transition ${
                isActive
                  ? "bg-[#2a2a2a] font-medium text-[#eee]"
                  : "text-[#999] hover:bg-[#222] hover:text-[#ccc]"
              }`}
            >
              <item.icon
                className={`h-4 w-4 ${isActive ? "text-[#ccc]" : "text-[#666]"}`}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Configure section */}
      <div className="mt-4 px-4">
        <span className="text-[12px] font-medium text-[#666]">Configure</span>
      </div>
      <div className="mt-1 px-2">
        {configureItems.map((item) => {
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveItem(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[14px] transition ${
                isActive
                  ? "bg-[#2a2a2a] font-medium text-[#eee]"
                  : "text-[#999] hover:bg-[#222] hover:text-[#ccc]"
              }`}
            >
              <item.icon
                className={`h-4 w-4 ${isActive ? "text-[#ccc]" : "text-[#666]"}`}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      {/* User profile card */}
      <div className="border-t border-[#252525] p-3">
        <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-[#252525]">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#333]">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=onion"
              alt="avatar"
              className="h-full w-full"
            />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[13px] font-medium text-[#ddd]">
              onionl5236
            </span>
            <span className="text-[12px] text-[#666]">
              onionl5236@gmail.c...
            </span>
          </div>
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Toolbar button helpers                                             */
/* ------------------------------------------------------------------ */
function ToolbarBtn({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: React.ElementType;
}) {
  return (
    <button className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#252525] px-2.5 py-1 text-[13px] text-[#bbb] transition hover:bg-[#2f2f2f]">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function ToolbarBtnWithChevron({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: React.ElementType;
}) {
  return (
    <button className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#252525] px-2.5 py-1 text-[13px] text-[#bbb] transition hover:bg-[#2f2f2f]">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
      <ChevronDown className="h-3 w-3 text-[#666]" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat Area                                                          */
/* ------------------------------------------------------------------ */
function ChatArea() {
  const [input, setInput] = useState("");

  return (
    <main className="flex flex-1 flex-col bg-[#181818]">
      {/* Top toolbar */}
      <header
        className="drag-region flex shrink-0 items-center justify-between border-b border-[#2a2a2a] px-4"
        style={{ height: "env(titlebar-area-height, 38px)" }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold text-[#eee]">New thread</h1>
          <span className="rounded-full bg-[#252525] px-2.5 py-0.5 text-[12px] text-[#888]">
            Timbre
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarBtn icon={Plus}>Add action</ToolbarBtn>
          <ToolbarBtnWithChevron icon={SquarePen}>
            Open
          </ToolbarBtnWithChevron>
          <ToolbarBtnWithChevron icon={GitBranch}>
            Commit
          </ToolbarBtnWithChevron>
          <button className="rounded-md border border-[#2a2a2a] bg-[#252525] p-1.5 text-[#bbb] transition hover:bg-[#2f2f2f]">
            <div className="h-3.5 w-3.5 rounded-sm border border-current" />
          </button>
          <button className="rounded-md border border-[#2a2a2a] bg-[#252525] p-1.5 text-[#bbb] transition hover:bg-[#2f2f2f]">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Empty state */}
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[15px] text-[#555]">
          Send a message to start the conversation.
        </p>
      </div>

      {/* Bottom input area */}
      <div className="border-t border-[#2a2a2a] px-4 pb-3 pt-3">
        <div className="rounded-xl border border-[#2f2f2f] bg-[#1e1e1e] p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for follow-up changes or attach images"
            className="w-full resize-none bg-transparent text-[15px] text-[#ddd] placeholder-[#555] outline-none"
            rows={3}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Model selector */}
              <button className="flex items-center gap-1.5 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
                <span className="text-[#e87d5a]">✦</span>
                <span>Claude Sonnet 4.6</span>
                <ChevronDown className="h-3 w-3 text-[#666]" />
              </button>
              <div className="h-3.5 w-px bg-[#333]" />
              <button className="flex items-center gap-1 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
                <span>High</span>
                <ChevronDown className="h-3 w-3 text-[#666]" />
              </button>
              <div className="h-3.5 w-px bg-[#333]" />
              <button className="flex items-center gap-1 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
                <Zap className="h-3 w-3" />
                <span>Build</span>
              </button>
              <div className="h-3.5 w-px bg-[#333]" />
              <button className="flex items-center gap-1 text-[13px] text-[#aaa] transition hover:text-[#ddd]">
                <Lock className="h-3 w-3" />
                <span>Full access</span>
                <ChevronDown className="h-3 w-3 text-[#666]" />
              </button>
            </div>
            <button className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4a6cf7] text-white transition hover:bg-[#3d5de4]">
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-2 flex items-center justify-between px-1">
          <button className="flex items-center gap-1.5 text-[12px] text-[#666] transition hover:text-[#999]">
            <div className="h-3 w-3 rounded-sm border border-current" />
            <span>Current checkout</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          <button className="flex items-center gap-1 text-[12px] text-[#666] transition hover:text-[#999]">
            <span>main</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  HomePage                                                           */
/* ------------------------------------------------------------------ */
export function HomePage() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#181818]">
      <Sidebar />
      <ChatArea />
    </div>
  );
}
