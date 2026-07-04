import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { ThreadHistoryPane } from "./chat/ThreadHistoryPane";

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const [isProjectSidebarCollapsed, setIsProjectSidebarCollapsed] = useState(false);

  return (
    <div className="h-screen w-screen overflow-hidden bg-bg text-fg">
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-sidebar shadow-[0_0_0_1px_rgb(255_255_255/0.02),0_18px_48px_rgb(0_0_0/0.18)]">
        <header
          className="drag-region flex shrink-0 items-center bg-sidebar"
          style={{
            height: "env(titlebar-area-height, 38px)",
            paddingLeft: "92px",
          }}
        >
          <button
            aria-label={isProjectSidebarCollapsed ? "Expand projects" : "Collapse projects"}
            title={isProjectSidebarCollapsed ? "Expand projects" : "Collapse projects"}
            onClick={() => setIsProjectSidebarCollapsed((collapsed) => !collapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:scale-95"
          >
            {isProjectSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </header>

        <div className="flex min-h-0 flex-1 bg-bg">
          <div
            className="min-h-0 shrink-0 transition-[width] duration-200 ease-out"
            style={{ width: isProjectSidebarCollapsed ? 58 : 280 }}
          >
            <SidebarNav collapsed={isProjectSidebarCollapsed} />
          </div>

          <div className="min-h-0 min-w-0 flex-1 bg-sidebar p-1.5 pl-0">
            <div
              className="grid h-full min-h-0 gap-1.5 transition-[grid-template-columns] duration-200 ease-out"
              style={{
                gridTemplateColumns: "minmax(270px, 320px) minmax(440px, 1fr)",
              }}
            >
              <ThreadHistoryPane />
              <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg">
                {children}
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
