import { useState, useRef, useCallback, useEffect } from "react";
import { SidebarNav } from "./SidebarNav";

const MIN_WIDTH = 180;
const DEFAULT_WIDTH = 240;
const COLLAPSED_WIDTH = 0;
const EXPAND_TRIGGER_WIDTH = 40;
const MAX_WIDTH_RATIO = 0.45;

function getMaxWidth() {
  return Math.floor(window.innerWidth * MAX_WIDTH_RATIO);
}

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleStartResize = useCallback(() => {
    if (isCollapsed) return;
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [isCollapsed]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const newWidth = Math.min(Math.max(MIN_WIDTH, e.clientX), getMaxWidth());
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setSidebarWidth(Math.min(Math.max(MIN_WIDTH, e.clientX), getMaxWidth()));
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      const maxW = getMaxWidth();
      if (!isCollapsed && sidebarWidth > maxW) {
        setSidebarWidth(maxW);
        if (sidebarRef.current) {
          sidebarRef.current.style.width = `${maxW}px`;
        }
      }
    };
    window.addEventListener("resize", handleWindowResize);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, isCollapsed, sidebarWidth]);

  const handleToggle = useCallback(() => {
    if (isCollapsed) {
      setIsCollapsed(false);
      setSidebarWidth(DEFAULT_WIDTH);
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${DEFAULT_WIDTH}px`;
      }
    } else {
      setIsCollapsed(true);
      setSidebarWidth(COLLAPSED_WIDTH);
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${COLLAPSED_WIDTH}px`;
      }
    }
  }, [isCollapsed]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#181818]">
      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className="relative flex shrink-0 flex-col overflow-hidden"
        style={{
          width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
          transition: isCollapsed ? "width 200ms ease" : undefined,
        }}
      >
        {!isCollapsed && (
          <>
            <SidebarNav onToggle={handleToggle} />
            {/* Resize handle */}
            <div
              onMouseDown={handleStartResize}
              className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-[#444]"
            />
          </>
        )}
      </div>

      {/* Collapsed trigger strip */}
      {isCollapsed && (
        <div
          className="flex shrink-0 flex-col items-center border-r border-[#252525] bg-[#1e1e1e]"
          style={{
            width: EXPAND_TRIGGER_WIDTH,
            paddingTop: "env(titlebar-area-height, 38px)",
          }}
        >
          <button
            onClick={handleToggle}
            className="mt-2 flex h-8 w-8 items-center justify-center rounded-md text-[#666] transition hover:bg-[#252525] hover:text-[#ccc]"
            title="Expand sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
              <path d="m14 9 3 3-3 3" />
            </svg>
          </button>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
