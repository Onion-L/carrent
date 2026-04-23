import { Upload, Square, Maximize2 } from "lucide-react";

export function ChatHeader() {
  return (
    <header className="flex shrink-0 items-center justify-between px-4 py-2">
      <h1 className="text-[15px] font-semibold text-[#eee]">New Chat</h1>
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1.5 rounded-md border border-[#333] bg-[#252525] px-3 py-1 text-[12px] text-[#bbb] transition hover:bg-[#2f2f2f]">
          <Upload className="h-3.5 w-3.5" />
          <span>Push</span>
        </button>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#666] transition hover:bg-[#252525] hover:text-[#999]">
          <Square className="h-4 w-4" />
        </button>
        <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#666] transition hover:bg-[#252525] hover:text-[#999]">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
