import { currentProject, threads, agents } from "../../mock/uiShellData";

export function ChatHeader() {
  const activeThread = threads.find((t) => t.active);
  const selectedAgent = agents.find((a) => a.selected);

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-[#2a2a2a] px-4 py-3">
      <div className="flex items-center gap-3">
        <h1 className="text-[15px] font-semibold text-[#eee]">
          {activeThread?.title ?? "New thread"}
        </h1>
        <span className="rounded-full bg-[#252525] px-2.5 py-0.5 text-[12px] text-[#888]">
          {currentProject.name}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {selectedAgent && (
          <span className="rounded-full border border-[#333] bg-[#1e1e1e] px-2.5 py-0.5 text-[12px] text-[#aaa]">
            {selectedAgent.name}
          </span>
        )}
        <span className="text-[12px] text-[#555]">UI shell only</span>
      </div>
    </header>
  );
}
