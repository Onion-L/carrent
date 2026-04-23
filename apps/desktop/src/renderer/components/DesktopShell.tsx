import { useState, useRef, useCallback, useEffect } from "react";
import { PanelLeftOpen } from "lucide-react";
import { SidebarNav } from "./SidebarNav";

const MIN_WIDTH = 180;
const DEFAULT_WIDTH = 240;
const COLLAPSED_WIDTH = 0;
const EXPAND_TRIGGER_WIDTH = 40;

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  const handleStartResize = useCallback(() => {
    if (isCollapsed) return;
    isDragging.current = true;
    startXRef.current = 0; // will be set in mousemove
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [isCollapsed, sidebarWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const newWidth = Math.max(MIN_WIDTH, e.clientX);
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setSidebarWidth(Math.max(MIN_WIDTH, e.clientX));
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleCollapse = useCallback(() => {
    setIsCollapsed(true);
    setSidebarWidth(COLLAPSED_WIDTH);
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${COLLAPSED_WIDTH}px`;
    }
  }, []);

  const handleExpand = useCallback(() => {
    setIsCollapsed(false);
    setSidebarWidth(DEFAULT_WIDTH);
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${DEFAULT_WIDTH}px`;
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#181818]">
      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className="relative flex shrink-0 flex-col overflow-hidden"
        style={{
          width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
          transition: isCollapsed ? "width 200ms ease" : undefined,
          paddingTop: isCollapsed ? undefined : "env(titlebar-area-height, 38px)",
        }}
      >
        {!isCollapsed && (
          <>
            <SidebarNav onCollapse={handleCollapse} />
            {/* Resize handle */}
            <div
              onMouseDown={handleStartResize}
              className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-[#444] active:bg-[#4a6cf7]"
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
