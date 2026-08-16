import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Code2, SquarePen } from "lucide-react";

import type { DetectedEditor } from "../../../shared/editors";
import cursorDarkIcon from "../../assets/editors/cursor-dark.png";
import cursorLightIcon from "../../assets/editors/cursor-light.png";
import finderIcon from "../../assets/editors/finder.png";
import vscodeIcon from "../../assets/editors/vscode.png";
import xcodeIcon from "../../assets/editors/xcode.png";
import zedDarkIcon from "../../assets/editors/zed-dark.png";
import zedLightIcon from "../../assets/editors/zed-light.png";
import { useSettings } from "../../context/SettingsContext";
import { ContextMenuShell, MenuItem } from "../workspace/ContextMenu";
import { useToast } from "../toast/ToastContext";

const MENU_ITEM_ICON_CLASS = "h-3.5 w-3.5 shrink-0 object-contain text-muted";
const LAST_EDITOR_STORAGE_KEY = "carrent:last-open-in-editor";

function loadLastEditorId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_EDITOR_STORAGE_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

const EDITOR_ICONS: Record<string, { light: string; dark?: string }> = {
  cursor: { light: cursorLightIcon, dark: cursorDarkIcon },
  vscode: { light: vscodeIcon },
  zed: { light: zedLightIcon, dark: zedDarkIcon },
  xcode: { light: xcodeIcon },
};

function editorIcon(editorId: string, isDark: boolean) {
  const icons = EDITOR_ICONS[editorId];
  if (!icons) return <Code2 className={MENU_ITEM_ICON_CLASS} />;

  return (
    <img
      src={isDark ? (icons.dark ?? icons.light) : icons.light}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={MENU_ITEM_ICON_CLASS}
    />
  );
}

export function OpenInMenu({
  workingDirectory,
  disabled,
}: {
  workingDirectory: string;
  disabled?: boolean;
}) {
  const { showToast } = useToast();
  const { theme } = useSettings();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [lastEditorId, setLastEditorId] = useState<string | null>(loadLastEditorId);
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const isDark = theme === "dark" || (theme === "system" && systemIsDark);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemIsDark(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, [theme]);

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

  useEffect(() => {
    const editorsApi = window.carrent.editors;
    if (typeof editorsApi?.list !== "function") return;
    editorsApi
      .list()
      .then(setEditors)
      .catch(() => showToast("Installed editors could not be detected.", "error"));
  }, [showToast]);

  const handleTriggerClick = () => {
    if (anchor) {
      closeMenu();
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    setAnchor({
      x: rect?.right ?? 0,
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

    setLastEditorId(editor.id);
    try {
      localStorage.setItem(LAST_EDITOR_STORAGE_KEY, editor.id);
    } catch {
      // Ignore unavailable or quota-limited storage; the default still works in memory.
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
      const result = await window.carrent.shell.revealPath(workingDirectory);
      if (!result.revealed) showToast("Working directory could not be found.", "error");
    } catch {
      showToast("Working directory could not be opened in Finder.", "error");
    }
  };

  const handleOpenDefault = async () => {
    closeMenu();
    if (!defaultEditor) {
      showToast("No installed editors were detected.", "error");
      return;
    }
    await handleOpenInEditor(defaultEditor);
  };

  // The trigger opens the editor picked last time; fall back to the first
  // detected editor when none was picked yet or it is no longer installed.
  const defaultEditor = editors.find((editor) => editor.id === lastEditorId) ?? editors[0];

  return (
    <>
      <div
        className={`order-first flex h-8 items-stretch overflow-hidden rounded-md border border-border bg-bg transition ${
          disabled ? "cursor-not-allowed text-subtle" : anchor ? "text-fg" : "text-muted"
        }`}
      >
        <button
          type="button"
          aria-label="Open working directory in default editor"
          title={defaultEditor ? `Open in ${defaultEditor.name}` : "Open in editor"}
          disabled={disabled}
          onClick={() => void handleOpenDefault()}
          className="flex items-center gap-1.5 px-1.5 transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-subtle"
        >
          {defaultEditor ? (
            <>
              {editorIcon(defaultEditor.id, isDark)}
              <span className="text-app-13 font-medium">{defaultEditor.name}</span>
            </>
          ) : (
            <SquarePen className="h-4 w-4" />
          )}
        </button>
        <div aria-hidden="true" className="my-1.5 w-px bg-border" />
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open working directory in editor or Finder"
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          title="Open in"
          disabled={disabled}
          onClick={handleTriggerClick}
          className="flex items-center px-1 transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-subtle"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      {anchor ? (
        <ContextMenuShell anchor={anchor} onClose={closeMenu} align="end">
          <div
            role="menu"
            aria-label="Open working directory in"
            className="w-48 rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
          >
            {editors.map((editor) => (
              <MenuItem
                key={editor.id}
                icon={editorIcon(editor.id, isDark)}
                label={editor.name}
                onClick={() => void handleOpenInEditor(editor)}
              />
            ))}
            {editors.length > 0 ? (
              <div role="separator" className="mx-2 my-1 border-t border-border" />
            ) : null}
            <MenuItem
              icon={
                <img
                  src={finderIcon}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className={MENU_ITEM_ICON_CLASS}
                />
              }
              label="Finder"
              onClick={() => void handleOpenInFinder()}
            />
          </div>
        </ContextMenuShell>
      ) : null}
    </>
  );
}
