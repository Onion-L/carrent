import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type LightboxAttachmentItem = {
  id: string;
  name: string;
  url: string;
};

export type StoredLightboxItem = {
  id: string;
  name: string;
  storageKey: string;
};

export type LightboxItem = LightboxAttachmentItem | StoredLightboxItem;

type ImageAttachmentLightboxProps = {
  items: LightboxItem[];
  initialIndex: number;
  onClose: () => void;
};

export const lightboxToolbarStyle: CSSProperties = {
  paddingTop: "env(titlebar-area-height, 38px)",
};

function isStoredItem(item: LightboxItem): item is StoredLightboxItem {
  return "storageKey" in item;
}

export function ImageAttachmentLightbox({
  items,
  initialIndex,
  onClose,
}: ImageAttachmentLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const createdUrlsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const currentItem = items[index];

  const resolveItemUrl = useCallback(
    async (item: LightboxItem): Promise<string> => {
      if (!isStoredItem(item)) {
        return item.url;
      }

      if (urls[item.id]) {
        return urls[item.id];
      }

      const data = await window.carrent.attachments.read(item.storageKey);
      const blob = new Blob([data.slice()], { type: "image/*" });
      const url = URL.createObjectURL(blob);
      if (!mountedRef.current) {
        URL.revokeObjectURL(url);
        return url;
      }
      createdUrlsRef.current.add(url);
      setUrls((prev) => ({ ...prev, [item.id]: url }));
      return url;
    },
    [urls],
  );

  useEffect(() => {
    if (currentItem && isStoredItem(currentItem) && !urls[currentItem.id]) {
      void resolveItemUrl(currentItem);
    }
  }, [currentItem, resolveItemUrl, urls]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        setIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if (event.key === "ArrowRight") {
        setIndex((prev) => Math.min(items.length - 1, prev + 1));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [items.length, onClose]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      createdUrlsRef.current.clear();
    };
  }, []);

  const currentUrl = useMemo(() => {
    if (!currentItem) {
      return null;
    }

    if (isStoredItem(currentItem)) {
      return urls[currentItem.id] ?? null;
    }

    return currentItem.url;
  }, [currentItem, urls]);

  const handlePrevious = useCallback(() => {
    setIndex((prev) => Math.max(0, prev - 1));
    setScale(1);
  }, []);

  const handleNext = useCallback(() => {
    setIndex((prev) => Math.min(items.length - 1, prev + 1));
    setScale(1);
  }, [items.length]);

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleResetZoom = useCallback(() => {
    setScale(1);
  }, []);

  if (items.length === 0 || !currentItem) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <div
        className="flex items-center justify-between px-4 pb-3"
        style={lightboxToolbarStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-white">{currentItem.name}</div>
          {items.length > 1 && (
            <div className="text-[12px] text-white/70">
              {index + 1} / {items.length}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentUrl && (
            <a
              href={currentUrl}
              download={currentItem.name}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10"
              title="Download"
              onClick={(event) => event.stopPropagation()}
            >
              <Download className="h-4 w-4" />
            </a>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleZoomOut();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleZoomIn();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleResetZoom();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10"
            title="Reset zoom"
          >
            <span className="text-[11px]">1:1</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onClick={onClose}
      >
        {currentUrl ? (
          <img
            src={currentUrl}
            alt={currentItem.name}
            className="max-h-full max-w-full object-contain transition-transform duration-150"
            style={{ transform: `scale(${scale})` }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <div className="text-[14px] text-white/70">Loading image...</div>
        )}

        {items.length > 1 && index > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handlePrevious();
            }}
            className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            title="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        {items.length > 1 && index < items.length - 1 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleNext();
            }}
            className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            title="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
