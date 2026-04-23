import { useState, useCallback, useEffect } from "react";
import { PanelLeftOpen } from "lucide-react";
import { SidebarNav } from "./SidebarNav";

const MIN_WIDTH = 180;
const DEFAULT_WIDTH = 240;
const COLLAPSED_WIDTH = 0;
const EXPAND_TRIGGER_WIDTH = 40;

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const handleStartResize = useCallback(() => {
    if (isCollapsed) return;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [isCollapsed]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(MIN_WIDTH, e.clientX);
      setSidebarWidth(newWidth);
      if (newWidth <= MIN_WIDTH + 20) {
        setIsCollapsed(true);
        setSidebarWidth(COLLAPSED_WIDTH);
        setIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleCollapse = useCallback(() => {
    setIsCollapsed(true);
    setSidebarWidth(COLLAPSED_WIDTH);
  }, []);

  const handleExpand = useCallback(() => {
    setIsCollapsed(false);
    setSidebarWidth(DEFAULT_WIDTH);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#181818]">
      {/* Sidebar */}
      <div
        className="relative flex shrink-0 flex-col overflow-hidden transition-[width] duration-200"
        style={{
          width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
          paddingTop: isCollapsed ? undefined : "env(titlebar-area-height, 38px)",
        }}
      >
        {!isCollapsed && (
          <>
            <SidebarNav width={sidebarWidth} onCollapse={handleCollapse} />
            {/* Resize handle */}
            <div
              onMouseDown={handleStartResize}
              className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition hover:bg-[#444]"
              style={{
                backgroundColor: isResizing ? "#4a6cf7" : undefined,
              }}
            />
          </>
        )}
      </div>

      {/* Collapsed trigger strip */}
      {isCollapsed && (
        <div
          className="flex shrink-0 flex-col items-center border-r border-[#252525] bg-[#181818]"
          style={{
            width: EXPAND_TRIGGER_WIDTH,
            paddingTop: "env(titlebar-area-height, 38px)",
          }}
        >
          <button
            onClick={handleExpand}
            className="mt-2 flex h-8 w-8 items-center justify-center rounded-md text-[#666] transition hover:bg-[#252525] hover:text-[#ccc]"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      <main className="flex min-w-0 flex-1">{children}</main>
    </div>
  );
}
