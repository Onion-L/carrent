import { Check, ChevronLeft, ChevronRight, Copy, X, ZoomIn, ZoomOut } from "lucide-react";
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
  mimeType?: string;
};

export type LightboxItem = LightboxAttachmentItem | StoredLightboxItem;

type ImageAttachmentLightboxProps = {
  items: LightboxItem[];
  initialIndex: number;
  onClose: () => void;
};

type ElectronToolbarStyle = CSSProperties & {
  WebkitAppRegion: "no-drag";
};

export const lightboxToolbarStyle: ElectronToolbarStyle = {
  paddingTop: "env(titlebar-area-height, 38px)",
  WebkitAppRegion: "no-drag",
};

export const COPY_IMAGE_FEEDBACK_MS = 3000;

function isStoredItem(item: LightboxItem): item is StoredLightboxItem {
  return "storageKey" in item;
}

export async function createStoredLightboxObjectUrl({
  item,
  readAttachment,
  createObjectUrl,
  revokeObjectUrl,
  isCancelled,
}: {
  item: StoredLightboxItem;
  readAttachment: (storageKey: string) => Promise<Uint8Array>;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  isCancelled: () => boolean;
}): Promise<string | null> {
  const data = await readAttachment(item.storageKey);
  const blob = new Blob([data.slice()], { type: item.mimeType ?? "image/*" });
  const url = createObjectUrl(blob);
  if (isCancelled()) {
    revokeObjectUrl(url);
    return null;
  }
  return url;
}

export async function copyImageUrlToClipboard({
  url,
  fetchBlob = async (imageUrl) => {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error("Unable to load image.");
    }
    return response.blob();
  },
  createClipboardItem = (items) => new ClipboardItem(items),
  writeClipboard = (items) => navigator.clipboard.write(items),
}: {
  url: string;
  fetchBlob?: (url: string) => Promise<Blob>;
  createClipboardItem?: (items: Record<string, Blob>) => ClipboardItem;
  writeClipboard?: (items: ClipboardItem[]) => Promise<void>;
}): Promise<void> {
  const blob = await fetchBlob(url);
  const mimeType = blob.type && blob.type !== "image/*" ? blob.type : "image/png";
  const clipboardBlob = blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType);
  await writeClipboard([createClipboardItem({ [mimeType]: clipboardBlob })]);
}

export function ImageAttachmentLightbox({
  items,
  initialIndex,
  onClose,
}: ImageAttachmentLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failedIds, setFailedIds] = useState<Record<string, true>>({});
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const createdUrlsRef = useRef<Set<string>>(new Set());
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentItem = items[index];

  useEffect(() => {
    if (!currentItem || !isStoredItem(currentItem) || urls[currentItem.id]) {
      return;
    }

    let cancelled = false;

    void createStoredLightboxObjectUrl({
      item: currentItem,
      readAttachment: (storageKey) => window.carrent.attachments.read(storageKey),
      createObjectUrl: (blob) => URL.createObjectURL(blob),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      isCancelled: () => cancelled,
    })
      .then((url) => {
        if (!url) {
          return;
        }
        createdUrlsRef.current.add(url);
        setUrls((prev) => ({ ...prev, [currentItem.id]: url }));
      })
      .catch(() => {
        if (!cancelled) {
          setFailedIds((prev) => ({ ...prev, [currentItem.id]: true }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentItem, urls]);

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
      createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      createdUrlsRef.current.clear();
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
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

  const isCurrentFailed = currentItem ? !!failedIds[currentItem.id] : false;

  useEffect(() => {
    setCopyConfirmed(false);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
  }, [currentUrl]);

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

  const handleCopyImage = useCallback(() => {
    if (!currentUrl || copyConfirmed) {
      return;
    }

    setCopyConfirmed(true);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = setTimeout(() => {
      copyResetTimerRef.current = null;
      setCopyConfirmed(false);
    }, COPY_IMAGE_FEEDBACK_MS);

    void copyImageUrlToClipboard({ url: currentUrl }).catch(() => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
      setCopyConfirmed(false);
    });
  }, [copyConfirmed, currentUrl]);

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
            <button
              type="button"
              disabled={copyConfirmed}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-default ${
                copyConfirmed ? "bg-white/15 text-white" : "text-white hover:bg-white/10"
              }`}
              title={copyConfirmed ? "Copied" : "Copy image"}
              onClick={(event) => {
                event.stopPropagation();
                handleCopyImage();
              }}
            >
              {copyConfirmed ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
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
        ) : isCurrentFailed ? (
          <div className="text-[14px] text-white/70">Image unavailable</div>
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
