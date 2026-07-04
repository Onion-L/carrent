import { useCallback, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLocation } from "react-router-dom";
import { SidebarNav } from "./SidebarNav";
import { ThreadHistoryPane } from "./chat/ThreadHistoryPane";
import { RuntimeListPane } from "./runtime/RuntimeListPane";

const LEFT_SIDEBAR_WIDTH = 58;
const MIN_SECONDARY_PANE_WIDTH = 200;
const MAX_SECONDARY_PANE_WIDTH = 480;
const DEFAULT_SECONDARY_PANE_WIDTH = 280;

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const [isSecondaryPaneCollapsed, setIsSecondaryPaneCollapsed] = useState(false);
  const [secondaryPaneWidth, setSecondaryPaneWidth] = useState(DEFAULT_SECONDARY_PANE_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ x: 0, width: DEFAULT_SECONDARY_PANE_WIDTH });
  const location = useLocation();
  const secondaryPane =
    location.pathname === "/runtimes" ? <RuntimeListPane /> : <ThreadHistoryPane />;

  const toggleSecondaryPane = useCallback(() => {
    setIsSecondaryPaneCollapsed((collapsed) => !collapsed);
  }, []);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      resizeStartRef.current = { x: event.clientX, width: secondaryPaneWidth };
      setIsResizing(true);
      document.body.style.userSelect = "none";

      const handleMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - resizeStartRef.current.x;
        const nextWidth = Math.max(
          MIN_SECONDARY_PANE_WIDTH,
          Math.min(MAX_SECONDARY_PANE_WIDTH, resizeStartRef.current.width + delta),
        );
        setSecondaryPaneWidth(nextWidth);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [secondaryPaneWidth],
  );

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
            aria-label={isSecondaryPaneCollapsed ? "Expand sessions" : "Collapse sessions"}
            title={isSecondaryPaneCollapsed ? "Expand sessions" : "Collapse sessions"}
            onClick={toggleSecondaryPane}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:scale-95"
          >
            {isSecondaryPaneCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </header>

        <div className="flex min-h-0 flex-1 bg-bg">
          <div className="min-h-0 shrink-0" style={{ width: LEFT_SIDEBAR_WIDTH }}>
            <SidebarNav collapsed={true} />
          </div>

          <div className="min-h-0 min-w-0 flex-1 bg-sidebar p-1.5 pl-0">
            <div className="flex h-full min-h-0">
              <div
                className={`min-h-0 shrink-0 overflow-hidden ${isResizing ? "" : "transition-[width] duration-200 ease-out"}`}
                style={{ width: isSecondaryPaneCollapsed ? 0 : secondaryPaneWidth }}
              >
                {secondaryPane}
              </div>

              {!isSecondaryPaneCollapsed && (
                <div onMouseDown={handleResizeStart} className="w-1 shrink-0 cursor-col-resize" />
              )}

              <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg">
                {children}
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
