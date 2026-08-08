import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Code2, Folder, SquarePen } from "lucide-react";

import type { DetectedEditor } from "../../../shared/editors";
import { ContextMenuShell, MenuItem } from "../workspace/ContextMenu";
import { useToast } from "../toast/ToastContext";

const MENU_ITEM_ICON_CLASS = "h-3.5 w-3.5 shrink-0 text-muted";

export function OpenInMenu({
  workingDirectory,
  disabled,
}: {
  workingDirectory: string;
  disabled?: boolean;
}) {
  const { showToast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [editors, setEditors] = useState<DetectedEditor[]>([]);

  const closeMenu = useCallback((returnFocus?: boolean) => {
    setAnchor(null);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      closeMenu();
    }
  }, [disabled, closeMenu]);

  const handleTriggerClick = async () => {
    if (anchor) {
      closeMenu();
      return;
    }

    let installed: DetectedEditor[] = [];
    const editorsApi = window.carrent.editors;
    if (typeof editorsApi?.list === "function") {
      try {
        installed = await editorsApi.list();
      } catch {
        showToast("Installed editors could not be detected.", "error");
      }
    }

    setEditors(installed);
    const rect = triggerRef.current?.getBoundingClientRect();
    setAnchor({
      x: rect?.left ?? 0,
      y: (rect?.bottom ?? 0) + 4,
    });
  };

  const handleOpenInEditor = async (editor: DetectedEditor) => {
    closeMenu();
    const editorsApi = window.carrent.editors;
    if (typeof editorsApi?.open !== "function") {
      showToast("Open in editor support is not loaded. Restart Carrent and try again.", "error");
      return;
    }

    try {
      const error = await editorsApi.open(editor.id, workingDirectory);
      if (error) showToast(error, "error");
    } catch {
      showToast(`Working directory could not be opened in ${editor.name}.`, "error");
    }
  };

  const handleOpenInFinder = async () => {
    closeMenu();
    try {
      const error = await window.carrent.shell.openPath(workingDirectory);
      if (error) showToast(error, "error");
    } catch {
      showToast("Working directory could not be opened in Finder.", "error");
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open working directory in editor or Finder"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title="Open in"
        disabled={disabled}
        onClick={() => void handleTriggerClick()}
        className={`flex h-7 items-center gap-0.5 rounded-md px-1.5 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-transparent ${
          anchor ? "text-fg" : "text-muted hover:text-fg"
        }`}
      >
        <SquarePen className="h-4 w-4" />
        <ChevronDown className="h-3 w-3" />
      </button>
      {anchor ? (
        <ContextMenuShell anchor={anchor} onClose={closeMenu}>
          <div
            role="menu"
            aria-label="Open working directory in"
            className="w-48 rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
          >
            {editors.map((editor) => (
              <MenuItem
                key={editor.id}
                icon={<Code2 className={MENU_ITEM_ICON_CLASS} />}
                label={editor.name}
                onClick={() => void handleOpenInEditor(editor)}
              />
            ))}
            {editors.length > 0 ? (
              <div role="separator" className="mx-2 my-1 border-t border-border" />
            ) : null}
            <MenuItem
              icon={<Folder className={MENU_ITEM_ICON_CLASS} />}
              label="Finder"
              onClick={() => void handleOpenInFinder()}
            />
          </div>
        </ContextMenuShell>
      ) : null}
    </>
  );
}
