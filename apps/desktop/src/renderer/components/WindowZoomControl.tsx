import { Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MainWindowZoomAction } from "../../shared/mainWindow";
import { useKeybinding } from "../hooks/useKeybinding";

export function WindowZoomControl() {
  const [factor, setFactor] = useState(1);
  const [isVisible, setIsVisible] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPopup = useCallback(() => {
    setIsVisible(true);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setIsVisible(false);
      dismissTimerRef.current = null;
    }, 1_800);
  }, []);

  useEffect(() => {
    let mounted = true;
    const removeListener = window.carrent.mainWindow.zoom.onFactorChange((nextFactor) => {
      if (mounted) {
        setFactor(nextFactor);
        showPopup();
      }
    });
    void window.carrent.mainWindow.zoom.getFactor().then((nextFactor) => {
      if (mounted) setFactor(nextFactor);
    });
    return () => {
      mounted = false;
      removeListener();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [showPopup]);

  const changeZoom = useCallback(
    async (action: MainWindowZoomAction) => {
      setFactor(await window.carrent.mainWindow.zoom.change(action));
      showPopup();
    },
    [showPopup],
  );

  useKeybinding("zoom-in", () => void changeZoom("in"));
  useKeybinding("zoom-out", () => void changeZoom("out"));
  useKeybinding("reset-zoom", () => void changeZoom("reset"));

  if (!isVisible) return null;

  return (
    <div className="no-drag absolute right-4 top-[calc(env(titlebar-area-height,38px)+0.5rem)] z-50 flex h-9 items-center rounded-lg border border-border-strong bg-surface px-1 text-muted shadow-xl">
      <output aria-label="Window zoom" className="w-12 text-center text-app-12 font-medium text-fg">
        {Math.round(factor * 100)}%
      </output>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => void changeZoom("out")}
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-surface-hover hover:text-fg active:scale-95"
      >
        <Minus aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => void changeZoom("in")}
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-surface-hover hover:text-fg active:scale-95"
      >
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Reset zoom"
        title="Reset zoom"
        disabled={Math.abs(factor - 1) < Number.EPSILON}
        onClick={() => void changeZoom("reset")}
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-surface-hover hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-35"
      >
        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
