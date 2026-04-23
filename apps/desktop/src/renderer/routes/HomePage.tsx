import { ArrowUp, ChevronDown, GitBranch, Plus, SquarePen, Zap, Lock } from "lucide-react";
import { useState } from "react";

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
  return <ChatArea />;
}
