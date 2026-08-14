import { useEffect } from "react";

import { isFilesystemFileDrag } from "../lib/fileDrag";

// Chromium navigates the webContents to a dropped file unless both dragover
// and drop are cancelled. ConversationDropSurface already cancels filesystem
// drags over the conversation; this guard cancels them window-wide so a file
// dropped on any other surface (sidebar, header, settings) cannot navigate
// Carrent away. Like ConversationDropSurface, drags carrying web content
// (URLs, page text, browser images without local backing files) are left
// untouched so their existing behavior is preserved.
export function installFileDropNavigationGuard(target: Window): () => void {
  const cancelFileDrop = (event: DragEvent) => {
    if (isFilesystemFileDrag(event.dataTransfer)) event.preventDefault();
  };
  target.addEventListener("dragover", cancelFileDrop);
  target.addEventListener("drop", cancelFileDrop);
  return () => {
    target.removeEventListener("dragover", cancelFileDrop);
    target.removeEventListener("drop", cancelFileDrop);
  };
}

export function useFileDropNavigationGuard() {
  useEffect(() => installFileDropNavigationGuard(window), []);
}
