import { useState, useRef, useCallback, useEffect } from "react";
import { SidebarNav } from "./SidebarNav";
import { SidebarContext } from "./SidebarContext";

const MIN_WIDTH = 180;
const DEFAULT_WIDTH = 240;
const COLLAPSED_WIDTH = 0;
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
    <SidebarContext.Provider value={{ toggle: handleToggle, isCollapsed }}>
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
              <SidebarNav />
              {/* Resize handle */}
              <div
                onMouseDown={handleStartResize}
                className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-[#444]"
              />
            </>
          )}
        </div>

        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </SidebarContext.Provider>
  );
}
