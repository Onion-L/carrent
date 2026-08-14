import { Folder } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { isSupportedImageMimeType } from "../../../shared/attachment";
import type { LocalPathContextItem } from "../../../shared/localPathContext";
import { isFilesystemFileDrag } from "../../lib/fileDrag";
import { useToast } from "../toast/ToastContext";

// What the active composition (the Composer) accepts from a drop: resolved
// Local Path Context items, and supported image files for the attachment
// pipeline. The composition keeps owning card state, deduplication, and
// attachment preparation; this module only classifies, resolves, and delivers.
type ConversationDropTarget = {
  onLocalPathItems: (items: LocalPathContextItem[]) => void;
  onImageFiles: (files: File[]) => void;
};

// Registration slot private to this module: only useConversationDropTarget
// consumes it, so no consumer depends on how delivery is wired.
type ConversationDropTargetRegistration = {
  setTarget: (target: ConversationDropTarget | null) => void;
};

const ConversationDropTargetContext = createContext<ConversationDropTargetRegistration | null>(
  null,
);

// Registers the calling composition as the drop target of the enclosing
// ConversationDropSurface. A composition rendered without a surface simply
// receives no drops, matching the previous optional-ref contract.
export function useConversationDropTarget(target: ConversationDropTarget): void {
  const registration = useContext(ConversationDropTargetContext);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!registration) return;
    // A stable proxy: the latest callbacks are read at drop time, so callers
    // can pass fresh closures on every render without re-registering.
    registration.setTarget({
      onLocalPathItems: (items) => targetRef.current.onLocalPathItems(items),
      onImageFiles: (files) => targetRef.current.onImageFiles(files),
    });
    return () => registration.setTarget(null);
  }, [registration]);
}

// Page-level surface that owns DOM drag state for the whole conversation area:
// the drop overlay, supported-image classification, privileged Local Path
// Context resolution, delivery to the active target, and one rejection toast.
export function ConversationDropSurface({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const dragDepthRef = useRef(0);
  const [dropActive, setDropActive] = useState(false);
  const targetRef = useRef<ConversationDropTarget | null>(null);

  const setTarget = useCallback((target: ConversationDropTarget | null) => {
    targetRef.current = target;
  }, []);
  const registration = useMemo(() => ({ setTarget }), [setTarget]);

  const resetDropState = useCallback(() => {
    dragDepthRef.current = 0;
    setDropActive(false);
  }, []);

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFilesystemFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDropActive(true);
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFilesystemFileDrag(event.dataTransfer)) return;
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  };

  // Safety net: a drag that ends anywhere in the window (or loses window focus
  // mid-drag) without a matching dragleave must not leave the overlay stuck.
  useEffect(() => {
    const reset = () => resetDropState();
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("blur", reset);
    };
  }, [resetDropState]);

  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFilesystemFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    resetDropState();

    // Images go through the attachment pipeline (thumbnail + preview); every
    // other local file or folder becomes Local Path Context.
    const files = Array.from(event.dataTransfer.files);
    const imageFiles = files.filter((file) => isSupportedImageMimeType(file.type));
    const contextFiles = files.filter((file) => !isSupportedImageMimeType(file.type));
    if (imageFiles.length > 0) {
      targetRef.current?.onImageFiles(imageFiles);
    }
    if (contextFiles.length === 0) return;

    try {
      const result = await window.carrent.localPaths.resolveDroppedItems(contextFiles);
      targetRef.current?.onLocalPathItems(result.items);
      if (result.rejections.length > 0) {
        showToast(
          result.rejections.length === 1
            ? "One dropped item is not an available local file or folder."
            : `${result.rejections.length} dropped items are not available local files or folders.`,
          "error",
        );
      }
    } catch {
      showToast("The dropped local file or folder could not be resolved.", "error");
    }
  };

  return (
    <ConversationDropTargetContext.Provider value={registration}>
      <div
        data-local-path-drop-surface
        className="relative flex min-h-0 flex-1 flex-col"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(event) => {
          if (isFilesystemFileDrag(event.dataTransfer)) event.preventDefault();
        }}
        onDrop={(event) => void handleDrop(event)}
      >
        {children}
        {dropActive ? (
          <div
            data-local-path-drop-overlay
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-fg/35 bg-surface-raised/90 text-fg"
            role="status"
          >
            <div className="flex items-center gap-2 text-app-13 font-medium">
              <Folder className="h-4 w-4" />
              <span>File or folder context</span>
            </div>
          </div>
        ) : null}
      </div>
    </ConversationDropTargetContext.Provider>
  );
}
