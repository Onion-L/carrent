import { currentProject } from "../../mock/uiShellData";
import { Upload, Square, Maximize2 } from "lucide-react";

export function ChatHeader() {
  return (
    <header
      className="drag-region flex shrink-0 items-center justify-between px-4"
      style={{ height: "env(titlebar-area-height, 38px)" }}
    >
      <h1 className="text-[14px] font-semibold text-[#eee]">New Chat</h1>
      <div className="flex items-center gap-1">
        <button className="no-drag flex items-center gap-1.5 rounded-md border border-[#333] bg-[#252525] px-3 py-1 text-[12px] text-[#bbb] transition hover:bg-[#2f2f2f]">
          <Upload className="h-3.5 w-3.5" />
          <span>Push</span>
        </button>
        <button className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-[#666] transition hover:bg-[#252525] hover:text-[#999]">
          <Square className="h-4 w-4" />
        </button>
        <button className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-[#666] transition hover:bg-[#252525] hover:text-[#999]">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
